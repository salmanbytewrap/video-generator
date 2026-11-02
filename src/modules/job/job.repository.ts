import { isValidObjectId } from 'mongoose';
import { BaseRepository, LeanDocument } from '../../repository/baseRepository';
import IRepository from '../../repository/interfaces';
import { FitMode, Platform } from '../generation/platformPresets';
import { JobModel, JobSchema, JOB_STATUSES } from './job.model';

export type JobStatus = (typeof JOB_STATUSES)[number];
export const ACTIVE_STATUSES: JobStatus[] = ['queued', 'processing'];

export interface JobOptions {
  fit: FitMode;
  trimStartSeconds: number;
  generateCaption: boolean;
}

export interface JobError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface JobCaption {
  text: string;
  hashtags: string[];
  simulated: boolean;
}

export interface Job {
  id: string;
  userId: string;
  inputAssetId: string;
  platform: Platform;
  format: string;
  options: JobOptions;
  status: JobStatus;
  progress: number;
  stage: string;
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
  lockedBy?: string;
  lockedUntil?: Date;
  cancelRequested: boolean;
  idempotencyKey?: string;
  error?: JobError;
  outputAssetId?: string;
  thumbnailAssetId?: string;
  caption?: JobCaption;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateJobData {
  userId: string;
  inputAssetId: string;
  platform: Platform;
  format: string;
  options: JobOptions;
  maxAttempts: number;
  idempotencyKey?: string;
}

export interface JobPage {
  items: Job[];
  total: number;
  page: number;
  limit: number;
}

export interface CompleteJobData {
  outputAssetId: string;
  thumbnailAssetId?: string;
  caption?: JobCaption;
}

export interface HeartbeatResult {
  alive: boolean;
  cancelRequested: boolean;
}

export interface JobRepository extends IRepository<Job, CreateJobData> {
  findOneForUser(id: string, userId: string): Promise<Job | null>;
  findByIdempotencyKey(userId: string, key: string): Promise<Job | null>;
  listForUser(userId: string, page: number, limit: number): Promise<JobPage>;
  countActiveForUser(userId: string): Promise<number>;
  claimNext(workerId: string, lockMs: number, now?: Date): Promise<Job | null>;
  heartbeat(id: string, workerId: string, lockMs: number, progress?: number, stage?: string): Promise<HeartbeatResult>;
  complete(id: string, workerId: string, data: CompleteJobData): Promise<boolean>;
  fail(id: string, workerId: string, error: JobError, retryAt?: Date): Promise<boolean>;
  markCancelled(id: string, workerId: string): Promise<boolean>;
  release(id: string, workerId: string): Promise<boolean>;
  requeueStale(now?: Date): Promise<{ requeued: number; failed: number }>;
  requestCancel(id: string, userId: string): Promise<Job | null>;
  resetForRetry(id: string, userId: string): Promise<Job | null>;
}

export class MongoJobRepository extends BaseRepository<JobSchema, Job, CreateJobData> implements JobRepository {
  constructor() {
    super(JobModel);
  }

  protected toEntity(doc: LeanDocument<JobSchema>): Job {
    const optionalId = (value: unknown) => (value ? String(value) : undefined);
    return {
      id: String(doc._id),
      userId: String(doc.userId),
      inputAssetId: String(doc.inputAssetId),
      platform: doc.platform,
      format: doc.format,
      options: {
        fit: doc.options?.fit ?? 'crop',
        trimStartSeconds: doc.options?.trimStartSeconds ?? 0,
        generateCaption: doc.options?.generateCaption ?? true,
      },
      status: doc.status,
      progress: doc.progress ?? 0,
      stage: doc.stage ?? doc.status,
      attempts: doc.attempts ?? 0,
      maxAttempts: doc.maxAttempts,
      runAfter: doc.runAfter ?? doc.createdAt,
      lockedBy: doc.lockedBy ?? undefined,
      lockedUntil: doc.lockedUntil ?? undefined,
      cancelRequested: Boolean(doc.cancelRequested),
      idempotencyKey: doc.idempotencyKey ?? undefined,
      error: doc.error?.message
        ? { code: doc.error.code ?? 'UNKNOWN', message: doc.error.message, retryable: Boolean(doc.error.retryable) }
        : undefined,
      outputAssetId: optionalId(doc.outputAssetId),
      thumbnailAssetId: optionalId(doc.thumbnailAssetId),
      caption: doc.caption?.text
        ? { text: doc.caption.text, hashtags: doc.caption.hashtags ?? [], simulated: Boolean(doc.caption.simulated) }
        : undefined,
      startedAt: doc.startedAt ?? undefined,
      completedAt: doc.completedAt ?? undefined,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  findOneForUser(id: string, userId: string): Promise<Job | null> {
    if (!isValidObjectId(id) || !isValidObjectId(userId)) return Promise.resolve(null);
    return this.findOneBy({ _id: id, userId });
  }

  findByIdempotencyKey(userId: string, key: string): Promise<Job | null> {
    return this.findOneBy({ userId, idempotencyKey: key });
  }

  async listForUser(userId: string, page: number, limit: number): Promise<JobPage> {
    const filter = { userId };
    const [docs, total] = await Promise.all([
      this._model
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<LeanDocument<JobSchema>[]>(),
      this._model.countDocuments(filter),
    ]);
    return { items: docs.map((doc) => this.toEntity(doc)), total, page, limit };
  }

  countActiveForUser(userId: string): Promise<number> {
    return this._model.countDocuments({ userId, status: { $in: ACTIVE_STATUSES } });
  }

  async claimNext(workerId: string, lockMs: number, now = new Date()): Promise<Job | null> {
    const doc = await this._model
      .findOneAndUpdate(
        { status: 'queued', runAfter: { $lte: now } },
        {
          $set: {
            status: 'processing',
            stage: 'starting',
            progress: 0,
            lockedBy: workerId,
            lockedUntil: new Date(now.getTime() + lockMs),
            startedAt: now,
          },
          $inc: { attempts: 1 },
          $unset: { error: 1 },
        },
        { sort: { runAfter: 1, createdAt: 1 }, returnDocument: 'after' },
      )
      .lean<LeanDocument<JobSchema>>();
    return doc ? this.toEntity(doc) : null;
  }

  async heartbeat(
    id: string,
    workerId: string,
    lockMs: number,
    progress?: number,
    stage?: string,
  ): Promise<HeartbeatResult> {
    const set: Record<string, unknown> = { lockedUntil: new Date(Date.now() + lockMs) };
    if (progress !== undefined) set.progress = Math.max(0, Math.min(100, Math.round(progress)));
    if (stage) set.stage = stage;
    const doc = await this._model
      .findOneAndUpdate({ _id: id, status: 'processing', lockedBy: workerId }, { $set: set }, { returnDocument: 'after' })
      .select('cancelRequested')
      .lean<{ cancelRequested?: boolean }>();
    return { alive: Boolean(doc), cancelRequested: Boolean(doc?.cancelRequested) };
  }

  async complete(id: string, workerId: string, data: CompleteJobData): Promise<boolean> {
    const result = await this._model.updateOne(
      { _id: id, status: 'processing', lockedBy: workerId },
      {
        $set: {
          status: 'completed',
          stage: 'completed',
          progress: 100,
          completedAt: new Date(),
          outputAssetId: data.outputAssetId,
          thumbnailAssetId: data.thumbnailAssetId,
          caption: data.caption,
        },
        $unset: { lockedBy: 1, lockedUntil: 1, error: 1 },
      },
    );
    return result.modifiedCount === 1;
  }

  async fail(id: string, workerId: string, error: JobError, retryAt?: Date): Promise<boolean> {
    const set = retryAt
      ? { status: 'queued', stage: 'retry scheduled', runAfter: retryAt, error }
      : { status: 'failed', stage: 'failed', completedAt: new Date(), error };
    const result = await this._model.updateOne(
      { _id: id, status: 'processing', lockedBy: workerId },
      { $set: set, $unset: { lockedBy: 1, lockedUntil: 1 } },
    );
    return result.modifiedCount === 1;
  }

  async markCancelled(id: string, workerId: string): Promise<boolean> {
    const result = await this._model.updateOne(
      { _id: id, status: 'processing', lockedBy: workerId },
      {
        $set: { status: 'cancelled', stage: 'cancelled', completedAt: new Date() },
        $unset: { lockedBy: 1, lockedUntil: 1 },
      },
    );
    return result.modifiedCount === 1;
  }

  async release(id: string, workerId: string): Promise<boolean> {
    const result = await this._model.updateOne(
      { _id: id, status: 'processing', lockedBy: workerId },
      {
        $set: { status: 'queued', stage: 'queued', progress: 0, runAfter: new Date() },
        $inc: { attempts: -1 },
        $unset: { lockedBy: 1, lockedUntil: 1 },
      },
    );
    return result.modifiedCount === 1;
  }

  async requeueStale(now = new Date()): Promise<{ requeued: number; failed: number }> {
    const stale = { status: 'processing' as const, lockedUntil: { $lt: now } };
    const failed = await this._model.updateMany(
      { ...stale, $expr: { $gte: ['$attempts', '$maxAttempts'] } },
      {
        $set: {
          status: 'failed',
          stage: 'failed',
          completedAt: now,
          error: { code: 'WORKER_LOST', message: 'Processing was interrupted too many times', retryable: true },
        },
        $unset: { lockedBy: 1, lockedUntil: 1 },
      },
    );
    const requeued = await this._model.updateMany(
      { ...stale, $expr: { $lt: ['$attempts', '$maxAttempts'] } },
      {
        $set: { status: 'queued', stage: 'requeued after interruption', runAfter: now },
        $unset: { lockedBy: 1, lockedUntil: 1 },
      },
    );
    return { requeued: requeued.modifiedCount, failed: failed.modifiedCount };
  }

  async requestCancel(id: string, userId: string): Promise<Job | null> {
    if (!isValidObjectId(id) || !isValidObjectId(userId)) return null;
    await this._model.updateOne(
      { _id: id, userId, status: 'queued' },
      { $set: { status: 'cancelled', stage: 'cancelled', completedAt: new Date() } },
    );
    await this._model.updateOne({ _id: id, userId, status: 'processing' }, { $set: { cancelRequested: true } });
    return this.findOneForUser(id, userId);
  }

  async resetForRetry(id: string, userId: string): Promise<Job | null> {
    if (!isValidObjectId(id) || !isValidObjectId(userId)) return null;
    const doc = await this._model
      .findOneAndUpdate(
        { _id: id, userId, status: { $in: ['failed', 'cancelled'] } },
        {
          $set: { status: 'queued', stage: 'queued', progress: 0, attempts: 0, runAfter: new Date(), cancelRequested: false },
          $unset: { error: 1, completedAt: 1, startedAt: 1 },
        },
        { returnDocument: 'after' },
      )
      .lean<LeanDocument<JobSchema>>();
    return doc ? this.toEntity(doc) : null;
  }
}
