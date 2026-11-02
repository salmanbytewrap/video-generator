import { z } from 'zod';
import { StorageProvider } from '../../storage';
import { BadRequestError, ConflictError, NotFoundError, TooManyRequestsError } from '../../utils/AppError';
import { Asset, AssetRepository } from '../asset';
import { FIT_MODES, getPreset, PlatformPreset, PLATFORMS, presetsByPlatform } from '../generation/platformPresets';
import { Job, JobPage, JobRepository } from './job.repository';

export const createJobSchema = z
  .object({
    inputAssetId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid asset id'),
    platform: z.enum(PLATFORMS),
    format: z.string().min(1).max(32),
    options: z
      .object({
        fit: z.enum(FIT_MODES).default('crop'),
        trimStartSeconds: z.number().min(0).max(3600).default(0),
        generateCaption: z.boolean().default(true),
      })
      .default({ fit: 'crop', trimStartSeconds: 0, generateCaption: true }),
  })
  .refine((v) => Boolean(getPreset(v.platform, v.format)), {
    message: 'Unsupported format for the selected platform',
    path: ['format'],
  });

export const listJobsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const idempotencyKeySchema = z.string().trim().min(8).max(128).regex(/^[\w-]+$/);

export interface JobServiceLimits {
  maxAttempts: number;
  maxActiveJobsPerUser: number;
}

export interface JobAssetView {
  id: string;
  kind: Asset['kind'];
  mimeType: string;
  originalName: string;
  width: number;
  height: number;
  durationSeconds?: number;
  url: string;
}

export interface JobView {
  id: string;
  status: Job['status'];
  progress: number;
  stage: string;
  platform: Job['platform'];
  format: string;
  preset: Pick<PlatformPreset, 'label' | 'aspectRatio' | 'width' | 'height' | 'maxDurationSeconds'>;
  options: Job['options'];
  attempts: number;
  maxAttempts: number;
  error?: { code: string; message: string; retryable: boolean };
  caption?: Job['caption'];
  input?: JobAssetView;
  output?: JobAssetView & { downloadUrl: string; size: number };
  thumbnailUrl?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface CreateJobResult {
  job: JobView;
  created: boolean;
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

export class JobService {
  constructor(
    private readonly jobs: JobRepository,
    private readonly assets: AssetRepository,
    private readonly storage: StorageProvider,
    private readonly limits: JobServiceLimits,
  ) {}

  getPresets() {
    return presetsByPlatform();
  }

  async createJob(userId: string, input: unknown, idempotencyKey?: string): Promise<CreateJobResult> {
    const key = idempotencyKey === undefined ? undefined : this.parseIdempotencyKey(idempotencyKey);
    if (key) {
      const existing = await this.jobs.findByIdempotencyKey(userId, key);
      if (existing) return { job: await this.toView(existing), created: false };
    }

    const data = createJobSchema.parse(input);
    const asset = await this.assets.findOneForUser(data.inputAssetId, userId);
    if (!asset || asset.role !== 'input') throw new NotFoundError('Input asset not found');
    if (asset.kind === 'video' && data.options.trimStartSeconds >= (asset.metadata.durationSeconds ?? 0)) {
      throw new BadRequestError('trimStartSeconds must be less than the video duration');
    }

    if ((await this.jobs.countActiveForUser(userId)) >= this.limits.maxActiveJobsPerUser) {
      throw new TooManyRequestsError(
        `You can have at most ${this.limits.maxActiveJobsPerUser} jobs in progress. Wait for one to finish.`,
      );
    }

    try {
      const job = await this.jobs.create({
        userId,
        inputAssetId: asset.id,
        platform: data.platform,
        format: data.format,
        options: data.options,
        maxAttempts: this.limits.maxAttempts,
        idempotencyKey: key,
      });
      return { job: await this.toView(job), created: true };
    } catch (err) {
      if (key && isDuplicateKeyError(err)) {
        const existing = await this.jobs.findByIdempotencyKey(userId, key);
        if (existing) return { job: await this.toView(existing), created: false };
      }
      throw err;
    }
  }

  async getJob(userId: string, id: string): Promise<JobView> {
    return this.toView(await this.getOwnedJob(userId, id));
  }

  async listJobs(userId: string, query: unknown): Promise<Omit<JobPage, 'items'> & { items: JobView[] }> {
    const { page, limit } = listJobsSchema.parse(query);
    const result = await this.jobs.listForUser(userId, page, limit);
    return { ...result, items: await Promise.all(result.items.map((job) => this.toView(job))) };
  }

  async retryJob(userId: string, id: string): Promise<JobView> {
    const job = await this.getOwnedJob(userId, id);
    if (job.status !== 'failed' && job.status !== 'cancelled') {
      throw new ConflictError('Only failed or cancelled jobs can be retried');
    }
    if ((await this.jobs.countActiveForUser(userId)) >= this.limits.maxActiveJobsPerUser) {
      throw new TooManyRequestsError(`You can have at most ${this.limits.maxActiveJobsPerUser} jobs in progress.`);
    }
    const reset = await this.jobs.resetForRetry(id, userId);
    if (!reset) throw new ConflictError('Job state changed; refresh and try again');
    return this.toView(reset);
  }

  async cancelJob(userId: string, id: string): Promise<JobView> {
    const job = await this.getOwnedJob(userId, id);
    if (job.status !== 'queued' && job.status !== 'processing') {
      throw new ConflictError('Only queued or processing jobs can be cancelled');
    }
    const updated = await this.jobs.requestCancel(id, userId);
    return this.toView(updated ?? job);
  }

  async getOutputUrl(userId: string, id: string, disposition: 'preview' | 'download'): Promise<{ url: string }> {
    const job = await this.getOwnedJob(userId, id);
    if (job.status !== 'completed' || !job.outputAssetId) throw new ConflictError('Job output is not ready yet');
    const output = await this.assets.findOne(job.outputAssetId);
    if (!output) throw new NotFoundError('Output has expired or was removed');
    const url = await this.storage.getDownloadUrl(output.storageKey, {
      contentType: output.mimeType,
      downloadName: disposition === 'download' ? output.originalName : undefined,
    });
    return { url };
  }

  private async getOwnedJob(userId: string, id: string): Promise<Job> {
    const job = await this.jobs.findOneForUser(id, userId);
    if (!job) throw new NotFoundError('Job not found');
    return job;
  }

  private parseIdempotencyKey(key: string): string {
    const result = idempotencyKeySchema.safeParse(key);
    if (!result.success) {
      throw new BadRequestError('Idempotency-Key must be 8-128 characters of letters, numbers, - or _');
    }
    return result.data;
  }

  private async assetView(asset: Asset): Promise<JobAssetView> {
    return {
      id: asset.id,
      kind: asset.kind,
      mimeType: asset.mimeType,
      originalName: asset.originalName,
      width: asset.metadata.width,
      height: asset.metadata.height,
      durationSeconds: asset.metadata.durationSeconds,
      url: await this.storage.getDownloadUrl(asset.storageKey, { contentType: asset.mimeType }),
    };
  }

  private async toView(job: Job): Promise<JobView> {
    const preset = getPreset(job.platform, job.format)!;
    const [input, output, thumbnail] = await Promise.all([
      this.assets.findOne(job.inputAssetId),
      job.outputAssetId ? this.assets.findOne(job.outputAssetId) : Promise.resolve(null),
      job.thumbnailAssetId ? this.assets.findOne(job.thumbnailAssetId) : Promise.resolve(null),
    ]);

    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      stage: job.stage,
      platform: job.platform,
      format: job.format,
      preset: {
        label: preset.label,
        aspectRatio: preset.aspectRatio,
        width: preset.width,
        height: preset.height,
        maxDurationSeconds: preset.maxDurationSeconds,
      },
      options: job.options,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      error: job.error,
      caption: job.caption,
      input: input ? await this.assetView(input) : undefined,
      output: output
        ? {
            ...(await this.assetView(output)),
            size: output.size,
            downloadUrl: await this.storage.getDownloadUrl(output.storageKey, {
              contentType: output.mimeType,
              downloadName: output.originalName,
            }),
          }
        : undefined,
      thumbnailUrl: thumbnail
        ? await this.storage.getDownloadUrl(thumbnail.storageKey, { contentType: thumbnail.mimeType })
        : undefined,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    };
  }
}
