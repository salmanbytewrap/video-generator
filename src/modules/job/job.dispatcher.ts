import { Queue } from 'bullmq';
import type { Job } from './job.repository';

export type DispatchableJob = Pick<Job, 'id' | 'attempts' | 'runAfter'>;

/** Tells workers that a MongoDB job is ready to run. MongoDB remains the source of truth for job state. */
export interface JobDispatcher {
  dispatch(job: DispatchableJob): Promise<void>;
  close(): Promise<void>;
}

/** QUEUE_DRIVER=mongo: workers poll MongoDB directly, so there is nothing to notify. */
export class NoopJobDispatcher implements JobDispatcher {
  async dispatch(): Promise<void> {}
  async close(): Promise<void> {}
}

export const GENERATE_JOB_NAME = 'generate';

export interface GenerateJobData {
  jobId: string;
}

/**
 * One BullMQ message per (job, attempt). The id makes re-dispatching the same attempt a no-op while the
 * message is pending, and completed messages are removed so a user retry can reuse attempt 0.
 */
export function bullJobId(job: Pick<Job, 'id' | 'attempts'>): string {
  return `${job.id}-a${job.attempts}`;
}

export class BullJobDispatcher implements JobDispatcher {
  constructor(private readonly queue: Queue<GenerateJobData>) {}

  async dispatch(job: DispatchableJob): Promise<void> {
    await this.queue.add(
      GENERATE_JOB_NAME,
      { jobId: job.id },
      {
        jobId: bullJobId(job),
        delay: Math.max(0, job.runAfter.getTime() - Date.now()),
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
