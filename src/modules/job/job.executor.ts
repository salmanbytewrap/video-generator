import { JobCancelledError, toJobError } from '../generation/errors';
import type { PipelineContext } from '../generation/pipeline';
import { CompleteJobData, Job, JobRepository } from './job.repository';

export type JobProcessor = (job: Job, ctx: PipelineContext) => Promise<CompleteJobData>;

export interface WorkerLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface JobExecutorOptions {
  workerId: string;
  lockMs: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
}

export type AbortReason = 'cancelled' | 'lock-lost' | 'shutdown';

export type JobOutcome =
  | { type: 'completed' }
  | { type: 'retry'; retryAt: Date }
  | { type: 'failed' }
  | { type: 'cancelled' }
  | { type: 'released' }
  | { type: 'lock-lost' }
  | { type: 'error' };

class LockLostError extends Error {
  constructor() {
    super('Job lock lost');
  }
}

export function computeBackoffMs(attempt: number, baseMs: number, maxMs: number, random = Math.random): number {
  const exponential = baseMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(maxMs, Math.round(exponential * (0.8 + random() * 0.4)));
}

/**
 * Runs one claimed job: heartbeats its lock, reports progress, honours cancellation and shutdown,
 * and records the outcome in MongoDB. Shared by every queue driver.
 */
export class JobExecutor {
  private readonly active = new Map<string, AbortController>();
  private readonly options: Required<JobExecutorOptions>;

  constructor(
    private readonly jobs: JobRepository,
    private readonly processor: JobProcessor,
    options: JobExecutorOptions,
    private readonly logger: WorkerLogger = console,
  ) {
    this.options = { backoffBaseMs: 5_000, backoffMaxMs: 5 * 60_000, ...options };
  }

  get activeCount(): number {
    return this.active.size;
  }

  abortAll(reason: AbortReason): void {
    for (const controller of this.active.values()) controller.abort(reason);
  }

  async run(job: Job): Promise<JobOutcome> {
    const controller = new AbortController();
    this.active.set(job.id, controller);
    try {
      return await this.execute(job, controller);
    } finally {
      this.active.delete(job.id);
    }
  }

  private async execute(job: Job, controller: AbortController): Promise<JobOutcome> {
    const { workerId, lockMs } = this.options;
    const log = { jobId: job.id, attempt: job.attempts, workerId };
    this.logger.info('job started', log);

    const beat = async (progress?: number, stage?: string) => {
      const result = await this.jobs.heartbeat(job.id, workerId, lockMs, progress, stage);
      if (!result.alive) controller.abort('lock-lost' satisfies AbortReason);
      else if (result.cancelRequested) controller.abort('cancelled' satisfies AbortReason);
    };
    const heartbeatTimer = setInterval(() => {
      beat().catch((err) => this.logger.warn('heartbeat failed', { ...log, error: (err as Error).message }));
    }, Math.max(1_000, Math.floor(lockMs / 3)));

    const ctx: PipelineContext = {
      signal: controller.signal,
      report: async (progress, stage) => {
        await beat(progress, stage);
        if (controller.signal.reason === 'lock-lost') throw new LockLostError();
        if (controller.signal.aborted) throw new JobCancelledError();
      },
    };

    try {
      const result = await this.processor(job, ctx);
      if (controller.signal.aborted) throw new JobCancelledError();
      const saved = await this.jobs.complete(job.id, workerId, result);
      this.logger.info(saved ? 'job completed' : 'job finished but lock was lost', log);
      return saved ? { type: 'completed' } : { type: 'lock-lost' };
    } catch (err) {
      return this.handleFailure(job, err, controller.signal.reason as AbortReason | undefined, log);
    } finally {
      clearInterval(heartbeatTimer);
    }
  }

  private async handleFailure(
    job: Job,
    err: unknown,
    abortReason: AbortReason | undefined,
    log: Record<string, unknown>,
  ): Promise<JobOutcome> {
    const { workerId } = this.options;
    try {
      if (abortReason === 'lock-lost' || err instanceof LockLostError) {
        this.logger.warn('job lock lost; leaving it to the new owner', log);
        return { type: 'lock-lost' };
      }
      if (abortReason === 'shutdown') {
        await this.jobs.release(job.id, workerId);
        this.logger.warn('job released for shutdown', log);
        return { type: 'released' };
      }
      if (abortReason === 'cancelled' || err instanceof JobCancelledError) {
        await this.jobs.markCancelled(job.id, workerId);
        this.logger.info('job cancelled', log);
        return { type: 'cancelled' };
      }

      const jobError = toJobError(err);
      const willRetry = jobError.retryable && job.attempts < job.maxAttempts;
      const retryAt = willRetry
        ? new Date(Date.now() + computeBackoffMs(job.attempts, this.options.backoffBaseMs, this.options.backoffMaxMs))
        : undefined;
      await this.jobs.fail(job.id, workerId, jobError, retryAt);
      this.logger[willRetry ? 'warn' : 'error']('job failed', {
        ...log,
        code: jobError.code,
        retryAt,
        cause: err instanceof Error ? err.message : String(err),
      });
      return retryAt ? { type: 'retry', retryAt } : { type: 'failed' };
    } catch (persistErr) {
      this.logger.error('could not persist job failure; the sweeper will recover it', {
        ...log,
        error: (persistErr as Error).message,
      });
      return { type: 'error' };
    }
  }
}
