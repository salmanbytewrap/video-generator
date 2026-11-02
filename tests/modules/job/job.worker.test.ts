import type { Mocked } from 'vitest';
import { JobCancelledError, PermanentError, RetryableError } from '../../../src/modules/generation/errors';
import { JobRepository } from '../../../src/modules/job';
import { computeBackoffMs, JobProcessor, JobWorker } from '../../../src/modules/job/job.worker';
import { buildJob, createMockJobRepository } from '../../support/mocks';

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const result = { outputAssetId: 'out-1', thumbnailAssetId: 'thumb-1' };

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('JobWorker', () => {
  let jobs: Mocked<JobRepository>;

  beforeEach(() => {
    jobs = createMockJobRepository();
    jobs.heartbeat.mockResolvedValue({ alive: true, cancelRequested: false });
    jobs.complete.mockResolvedValue(true);
    jobs.fail.mockResolvedValue(true);
    jobs.requeueStale.mockResolvedValue({ requeued: 0, failed: 0 });
  });

  function createWorker(processor: JobProcessor, overrides = {}) {
    return new JobWorker(
      jobs,
      processor,
      { workerId: 'w1', concurrency: 1, pollIntervalMs: 10, lockMs: 3_000, backoffBaseMs: 1_000, shutdownGraceMs: 50, ...overrides },
      silentLogger,
    );
  }

  async function runOne(worker: JobWorker) {
    expect(await worker.tick()).toBe(true);
    await vi.waitFor(() => expect(worker.activeCount).toBe(0));
  }

  it('computeBackoffMs_GrowsExponentiallyWithJitterAndCap', () => {
    expect(computeBackoffMs(1, 1000, 60_000, () => 0.5)).toBe(1000);
    expect(computeBackoffMs(3, 1000, 60_000, () => 0.5)).toBe(4000);
    expect(computeBackoffMs(3, 1000, 60_000, () => 0)).toBe(3200);
    expect(computeBackoffMs(20, 1000, 60_000, () => 1)).toBe(60_000);
  });

  it('tick_WithEmptyQueue_ReturnsFalse', async () => {
    jobs.claimNext.mockResolvedValue(null);

    expect(await createWorker(vi.fn()).tick()).toBe(false);
  });

  it('tick_WhenSuccessful_CompletesJobWithProcessorResult', async () => {
    jobs.claimNext.mockResolvedValue(buildJob({ status: 'processing', attempts: 1 }));
    const processor = vi.fn(async (_job, ctx) => {
      await ctx.report(50, 'transcoding');
      return result;
    });

    await runOne(createWorker(processor));

    expect(jobs.heartbeat).toHaveBeenCalledWith(expect.any(String), 'w1', 3_000, 50, 'transcoding');
    expect(jobs.complete).toHaveBeenCalledWith(expect.any(String), 'w1', result);
  });

  it('tick_WithRetryableErrorAndAttemptsLeft_SchedulesRetryWithBackoff', async () => {
    jobs.claimNext.mockResolvedValue(buildJob({ attempts: 1, maxAttempts: 3 }));
    const before = Date.now();

    await runOne(createWorker(vi.fn().mockRejectedValue(new RetryableError('STORAGE_ERROR', 'blip'))));

    const [, , error, retryAt] = jobs.fail.mock.calls[0];
    expect(error).toEqual({ code: 'STORAGE_ERROR', message: 'blip', retryable: true });
    expect(retryAt!.getTime()).toBeGreaterThanOrEqual(before + 800);
  });

  it('tick_WithRetryableErrorOnLastAttempt_FailsPermanently', async () => {
    jobs.claimNext.mockResolvedValue(buildJob({ attempts: 3, maxAttempts: 3 }));

    await runOne(createWorker(vi.fn().mockRejectedValue(new RetryableError('STORAGE_ERROR', 'blip'))));

    expect(jobs.fail.mock.calls[0][3]).toBeUndefined();
  });

  it('tick_WithPermanentError_FailsWithoutRetry', async () => {
    jobs.claimNext.mockResolvedValue(buildJob({ attempts: 1 }));

    await runOne(createWorker(vi.fn().mockRejectedValue(new PermanentError('INVALID_MEDIA', 'bad file'))));

    expect(jobs.fail).toHaveBeenCalledWith(expect.any(String), 'w1', expect.objectContaining({ code: 'INVALID_MEDIA' }), undefined);
  });

  it('tick_WhenUserCancelsDuringProcessing_AbortsAndMarksCancelled', async () => {
    jobs.claimNext.mockResolvedValue(buildJob({ attempts: 1 }));
    jobs.heartbeat.mockResolvedValue({ alive: true, cancelRequested: true });
    const processor: JobProcessor = async (_job, ctx) => {
      await ctx.report(10, 'transcoding');
      return result;
    };

    await runOne(createWorker(processor));

    expect(jobs.markCancelled).toHaveBeenCalledWith(expect.any(String), 'w1');
    expect(jobs.complete).not.toHaveBeenCalled();
  });

  it('tick_WhenProcessorThrowsCancelled_MarksCancelled', async () => {
    jobs.claimNext.mockResolvedValue(buildJob({ attempts: 1 }));

    await runOne(createWorker(vi.fn().mockRejectedValue(new JobCancelledError())));

    expect(jobs.markCancelled).toHaveBeenCalled();
  });

  it('tick_WhenLockIsLost_LeavesJobAlone', async () => {
    jobs.claimNext.mockResolvedValue(buildJob({ attempts: 1 }));
    jobs.heartbeat.mockResolvedValue({ alive: false, cancelRequested: false });
    const processor: JobProcessor = async (_job, ctx) => {
      await ctx.report(10, 'transcoding');
      return result;
    };

    await runOne(createWorker(processor));

    expect(jobs.fail).not.toHaveBeenCalled();
    expect(jobs.markCancelled).not.toHaveBeenCalled();
    expect(jobs.complete).not.toHaveBeenCalled();
  });

  it('tick_WhenPersistingFailureFails_LogsAndDoesNotThrow', async () => {
    jobs.claimNext.mockResolvedValue(buildJob({ attempts: 1 }));
    jobs.fail.mockRejectedValue(new Error('db down'));

    await runOne(createWorker(vi.fn().mockRejectedValue(new Error('boom'))));

    expect(silentLogger.error).toHaveBeenCalledWith(expect.stringContaining('could not persist'), expect.any(Object));
  });

  it('tick_AtConcurrencyLimit_DoesNotClaim', async () => {
    const gate = deferred();
    jobs.claimNext.mockResolvedValue(buildJob());
    const worker = createWorker(vi.fn(() => gate.promise.then(() => result)));

    await worker.tick();
    expect(await worker.tick()).toBe(false);
    expect(jobs.claimNext).toHaveBeenCalledTimes(1);

    gate.resolve();
    await vi.waitFor(() => expect(worker.activeCount).toBe(0));
  });

  it('stop_WhenJobOutlivesGracePeriod_ReleasesItBackToQueue', async () => {
    jobs.claimNext.mockResolvedValueOnce(buildJob({ attempts: 1 })).mockResolvedValue(null);
    const processor: JobProcessor = (_job, ctx) =>
      new Promise((_resolve, reject) => ctx.signal.addEventListener('abort', () => reject(new JobCancelledError())));
    const worker = createWorker(processor);

    worker.start();
    await vi.waitFor(() => expect(worker.activeCount).toBe(1));
    await worker.stop();

    expect(jobs.release).toHaveBeenCalledWith(expect.any(String), 'w1');
    expect(jobs.markCancelled).not.toHaveBeenCalled();
  });

  it('start_RunsStaleSweepAndPollsQueue', async () => {
    jobs.claimNext.mockResolvedValue(null);
    jobs.requeueStale.mockResolvedValue({ requeued: 2, failed: 1 });
    const worker = createWorker(vi.fn());

    worker.start();
    worker.start();
    await vi.waitFor(() => expect(jobs.claimNext.mock.calls.length).toBeGreaterThan(1));
    await worker.stop();
    await worker.stop();

    expect(silentLogger.warn).toHaveBeenCalledWith('recovered stale jobs', { requeued: 2, failed: 1 });
  });

  it('sweep_WhenRepositoryFails_LogsError', async () => {
    jobs.requeueStale.mockRejectedValue(new Error('db down'));

    await createWorker(vi.fn()).sweep();

    expect(silentLogger.error).toHaveBeenCalledWith('stale job sweep failed', { error: 'db down' });
  });
});
