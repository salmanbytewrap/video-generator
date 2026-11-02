import { JobCancelledError, toJobError } from '../generation/errors';
import type { PipelineContext } from '../generation/pipeline';
import { CompleteJobData, Job, JobRepository } from './job.repository';

export type JobProcessor = (job: Job, ctx: PipelineContext) => Promise<CompleteJobData>;

export interface WorkerLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface JobWorkerOptions {
  workerId: string;
  concurrency: number;
  pollIntervalMs: number;
  lockMs: number;
  sweepIntervalMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  shutdownGraceMs?: number;
}

type AbortReason = 'cancelled' | 'lock-lost' | 'shutdown';

class LockLostError extends Error {
  constructor() {
    super('Job lock lost');
  }
}

export function computeBackoffMs(attempt: number, baseMs: number, maxMs: number, random = Math.random): number {
  const exponential = baseMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(maxMs, Math.round(exponential * (0.8 + random() * 0.4)));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class JobWorker {
  private running = false;
  private loopPromise?: Promise<void>;
  private sweepTimer?: NodeJS.Timeout;
  private readonly active = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private readonly options: Required<JobWorkerOptions>;

  constructor(
    private readonly jobs: JobRepository,
    private readonly processor: JobProcessor,
    options: JobWorkerOptions,
    private readonly logger: WorkerLogger = console,
  ) {
    this.options = {
      sweepIntervalMs: options.lockMs,
      backoffBaseMs: 5_000,
      backoffMaxMs: 5 * 60_000,
      shutdownGraceMs: 30_000,
      ...options,
    };
  }

  get activeCount(): number {
    return this.active.size;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.sweepTimer = setInterval(() => void this.sweep(), this.options.sweepIntervalMs);
    void this.sweep();
    this.loopPromise = this.loop();
    this.logger.info('worker started', { workerId: this.options.workerId, concurrency: this.options.concurrency });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.sweepTimer);
    await this.loopPromise;

    const pending = [...this.active.values()].map((entry) => entry.done);
    const graceful = await Promise.race([
      Promise.all(pending).then(() => true),
      sleep(this.options.shutdownGraceMs).then(() => false),
    ]);
    if (!graceful) {
      for (const { controller } of this.active.values()) controller.abort('shutdown' satisfies AbortReason);
      await Promise.all(pending);
    }
    this.logger.info('worker stopped', { workerId: this.options.workerId });
  }

  /** Claims and runs at most one job. Returns false when the queue is empty or the worker is full. */
  async tick(): Promise<boolean> {
    if (this.active.size >= this.options.concurrency) return false;
    const job = await this.jobs.claimNext(this.options.workerId, this.options.lockMs);
    if (!job) return false;

    const controller = new AbortController();
    const done = this.process(job, controller).finally(() => this.active.delete(job.id));
    this.active.set(job.id, { controller, done });
    return true;
  }

  async sweep(): Promise<void> {
    try {
      const result = await this.jobs.requeueStale();
      if (result.requeued || result.failed) this.logger.warn('recovered stale jobs', result);
    } catch (err) {
      this.logger.error('stale job sweep failed', { error: (err as Error).message });
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      let claimed = false;
      try {
        claimed = await this.tick();
      } catch (err) {
        this.logger.error('failed to claim job', { error: (err as Error).message });
      }
      if (!claimed) await sleep(this.options.pollIntervalMs);
    }
  }

  private async process(job: Job, controller: AbortController): Promise<void> {
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
    } catch (err) {
      await this.handleFailure(job, err, controller.signal.reason as AbortReason | undefined, log);
    } finally {
      clearInterval(heartbeatTimer);
    }
  }

  private async handleFailure(
    job: Job,
    err: unknown,
    abortReason: AbortReason | undefined,
    log: Record<string, unknown>,
  ): Promise<void> {
    const { workerId } = this.options;
    try {
      if (abortReason === 'lock-lost' || err instanceof LockLostError) {
        this.logger.warn('job lock lost; leaving it to the new owner', log);
        return;
      }
      if (abortReason === 'shutdown') {
        await this.jobs.release(job.id, workerId);
        this.logger.warn('job released for shutdown', log);
        return;
      }
      if (abortReason === 'cancelled' || err instanceof JobCancelledError) {
        await this.jobs.markCancelled(job.id, workerId);
        this.logger.info('job cancelled', log);
        return;
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
    } catch (persistErr) {
      this.logger.error('could not persist job failure; the sweeper will recover it', {
        ...log,
        error: (persistErr as Error).message,
      });
    }
  }
}
