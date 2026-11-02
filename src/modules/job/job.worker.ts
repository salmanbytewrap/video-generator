import { JobExecutor, JobProcessor, WorkerLogger } from './job.executor';
import { JobRepository } from './job.repository';

export { computeBackoffMs } from './job.executor';
export type { JobProcessor, WorkerLogger } from './job.executor';

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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Queue driver that polls MongoDB for work (QUEUE_DRIVER=mongo). */
export class JobWorker {
  private running = false;
  private loopPromise?: Promise<void>;
  private sweepTimer?: NodeJS.Timeout;
  private readonly pending = new Set<Promise<unknown>>();
  private readonly executor: JobExecutor;
  private readonly options: Required<Pick<JobWorkerOptions, 'sweepIntervalMs' | 'shutdownGraceMs'>> & JobWorkerOptions;

  constructor(
    private readonly jobs: JobRepository,
    processor: JobProcessor,
    options: JobWorkerOptions,
    private readonly logger: WorkerLogger = console,
  ) {
    this.options = { sweepIntervalMs: options.lockMs, shutdownGraceMs: 30_000, ...options };
    this.executor = new JobExecutor(jobs, processor, options, logger);
  }

  get activeCount(): number {
    return this.executor.activeCount;
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
    await drainWithGrace(this.pending, this.executor, this.options.shutdownGraceMs);
    this.logger.info('worker stopped', { workerId: this.options.workerId });
  }

  /** Claims and runs at most one job. Returns false when the queue is empty or the worker is full. */
  async tick(): Promise<boolean> {
    if (this.executor.activeCount >= this.options.concurrency) return false;
    const job = await this.jobs.claimNext(this.options.workerId, this.options.lockMs);
    if (!job) return false;

    const done = this.executor.run(job).finally(() => this.pending.delete(done));
    this.pending.add(done);
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
}

/** Waits for in-flight jobs; after the grace period, aborts them so they are released back to the queue. */
export async function drainWithGrace(pending: Set<Promise<unknown>>, executor: JobExecutor, graceMs: number) {
  const all = [...pending];
  const graceful = await Promise.race([
    Promise.all(all).then(() => true),
    sleep(graceMs).then(() => false),
  ]);
  if (!graceful) {
    executor.abortAll('shutdown');
    await Promise.all(all);
  }
}
