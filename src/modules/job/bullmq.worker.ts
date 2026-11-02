import { ConnectionOptions, Job as BullJob, Worker } from 'bullmq';
import { GenerateJobData, JobDispatcher } from './job.dispatcher';
import { JobExecutor, JobProcessor, WorkerLogger } from './job.executor';
import { JobRepository } from './job.repository';
import { drainWithGrace } from './job.worker';

export interface BullJobWorkerOptions {
  queueName: string;
  connection: ConnectionOptions;
  workerId: string;
  concurrency: number;
  lockMs: number;
  reconcileIntervalMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  shutdownGraceMs?: number;
}

/**
 * Queue driver backed by BullMQ on Redis (QUEUE_DRIVER=bullmq).
 *
 * BullMQ only delivers job ids; each delivery claims the MongoDB job atomically, so duplicate or late
 * deliveries are harmless. Retries are re-dispatched with a delay, and a reconciler re-dispatches any
 * queued job whose message was lost (Redis flush, failed enqueue, crash recovery by the stale sweeper).
 */
export class BullJobWorker {
  private worker?: Worker<GenerateJobData>;
  private reconcileTimer?: NodeJS.Timeout;
  private readonly pending = new Set<Promise<unknown>>();
  private readonly executor: JobExecutor;
  private readonly options: Required<Pick<BullJobWorkerOptions, 'reconcileIntervalMs' | 'shutdownGraceMs'>> &
    BullJobWorkerOptions;

  constructor(
    private readonly jobs: JobRepository,
    processor: JobProcessor,
    private readonly dispatcher: JobDispatcher,
    options: BullJobWorkerOptions,
    private readonly logger: WorkerLogger = console,
  ) {
    this.options = { reconcileIntervalMs: 15_000, shutdownGraceMs: 30_000, ...options };
    this.executor = new JobExecutor(jobs, processor, options, logger);
  }

  get activeCount(): number {
    return this.executor.activeCount;
  }

  start(): void {
    if (this.worker) return;
    const { queueName, connection, concurrency, workerId } = this.options;
    this.worker = new Worker<GenerateJobData>(queueName, (bullJob) => this.handle(bullJob), {
      connection,
      concurrency,
      name: workerId,
    });
    this.worker.on('error', (err) => this.logger.error('bullmq worker error', { error: err.message }));
    this.reconcileTimer = setInterval(() => void this.reconcile(), this.options.reconcileIntervalMs);
    void this.reconcile();
    this.logger.info('worker started', { workerId, concurrency, driver: 'bullmq' });
  }

  async stop(): Promise<void> {
    if (!this.worker) return;
    clearInterval(this.reconcileTimer);
    const closing = this.worker.close();
    await drainWithGrace(this.pending, this.executor, this.options.shutdownGraceMs);
    await closing;
    this.worker = undefined;
    this.logger.info('worker stopped', { workerId: this.options.workerId });
  }

  async handle(bullJob: Pick<BullJob<GenerateJobData>, 'data'>): Promise<void> {
    const job = await this.jobs.claimById(bullJob.data.jobId, this.options.workerId, this.options.lockMs);
    if (!job) return;

    const run = this.executor.run(job);
    this.pending.add(run);
    try {
      const outcome = await run;
      if (outcome.type === 'retry') await this.redispatch({ id: job.id, attempts: job.attempts, runAfter: outcome.retryAt });
    } finally {
      this.pending.delete(run);
    }
  }

  /** Recovers stale locks, then makes sure every runnable queued job has a pending message. */
  async reconcile(): Promise<void> {
    try {
      const stale = await this.jobs.requeueStale();
      if (stale.requeued || stale.failed) this.logger.warn('recovered stale jobs', stale);
      const queued = await this.jobs.findDispatchable();
      await Promise.all(queued.map((job) => this.redispatch(job)));
    } catch (err) {
      this.logger.error('job reconcile failed', { error: (err as Error).message });
    }
  }

  private async redispatch(job: Parameters<JobDispatcher['dispatch']>[0]): Promise<void> {
    try {
      await this.dispatcher.dispatch(job);
    } catch (err) {
      this.logger.warn('dispatch failed; the reconciler will retry', { jobId: job.id, error: (err as Error).message });
    }
  }
}
