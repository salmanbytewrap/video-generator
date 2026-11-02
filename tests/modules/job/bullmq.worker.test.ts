import type { Mocked } from 'vitest';
import { PermanentError, RetryableError } from '../../../src/modules/generation/errors';
import { JobRepository } from '../../../src/modules/job';
import { BullJobWorker } from '../../../src/modules/job/bullmq.worker';
import { BullJobDispatcher, bullJobId, JobDispatcher, NoopJobDispatcher } from '../../../src/modules/job/job.dispatcher';
import { JobProcessor } from '../../../src/modules/job/job.executor';
import { buildJob, createMockJobRepository } from '../../support/mocks';

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const result = { outputAssetId: 'out-1', thumbnailAssetId: 'thumb-1' };

describe('job dispatchers', () => {
  it('bullJobId_CombinesJobIdAndAttemptWithoutColons', () => {
    expect(bullJobId({ id: 'abc', attempts: 2 })).toBe('abc-a2');
  });

  it('BullJobDispatcher_Dispatch_AddsOneMessagePerAttemptWithDelay', async () => {
    const queue = { add: vi.fn().mockResolvedValue(undefined), close: vi.fn() };
    const dispatcher = new BullJobDispatcher(queue as never);
    const runAfter = new Date(Date.now() + 10_000);

    await dispatcher.dispatch({ id: 'job-1', attempts: 1, runAfter });

    const [name, data, opts] = queue.add.mock.calls[0];
    expect(name).toBe('generate');
    expect(data).toEqual({ jobId: 'job-1' });
    expect(opts).toMatchObject({ jobId: 'job-1-a1', attempts: 1, removeOnComplete: true, removeOnFail: true });
    expect(opts.delay).toBeGreaterThan(9_000);
    expect(opts.delay).toBeLessThanOrEqual(10_000);
  });

  it('BullJobDispatcher_WithPastRunAfter_UsesZeroDelay', async () => {
    const queue = { add: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
    const dispatcher = new BullJobDispatcher(queue as never);

    await dispatcher.dispatch({ id: 'job-1', attempts: 0, runAfter: new Date(0) });
    await dispatcher.close();

    expect(queue.add.mock.calls[0][2].delay).toBe(0);
    expect(queue.close).toHaveBeenCalled();
  });

  it('NoopJobDispatcher_DoesNothing', async () => {
    await expect(new NoopJobDispatcher().dispatch()).resolves.toBeUndefined();
  });
});

describe('BullJobWorker', () => {
  let jobs: Mocked<JobRepository>;
  let dispatcher: Mocked<JobDispatcher>;

  beforeEach(() => {
    jobs = createMockJobRepository();
    jobs.heartbeat.mockResolvedValue({ alive: true, cancelRequested: false });
    jobs.complete.mockResolvedValue(true);
    jobs.fail.mockResolvedValue(true);
    jobs.requeueStale.mockResolvedValue({ requeued: 0, failed: 0 });
    dispatcher = { dispatch: vi.fn().mockResolvedValue(undefined), close: vi.fn() };
  });

  function createWorker(processor: JobProcessor) {
    return new BullJobWorker(
      jobs,
      processor,
      dispatcher,
      { queueName: 'test', connection: {}, workerId: 'w1', concurrency: 1, lockMs: 3_000, backoffBaseMs: 1_000 },
      silentLogger,
    );
  }

  it('handle_WhenJobIsNoLongerQueued_IgnoresTheDelivery', async () => {
    const processor = vi.fn();
    jobs.claimById.mockResolvedValue(null);

    await createWorker(processor).handle({ data: { jobId: 'job-1' } });

    expect(jobs.claimById).toHaveBeenCalledWith('job-1', 'w1', 3_000);
    expect(processor).not.toHaveBeenCalled();
  });

  it('handle_WithSuccessfulProcessor_CompletesTheJob', async () => {
    jobs.claimById.mockResolvedValue(buildJob({ id: 'job-1', attempts: 1, status: 'processing' }));

    await createWorker(vi.fn().mockResolvedValue(result)).handle({ data: { jobId: 'job-1' } });

    expect(jobs.complete).toHaveBeenCalledWith('job-1', 'w1', result);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('handle_WithRetryableFailure_RedispatchesTheNextAttemptAtRetryTime', async () => {
    jobs.claimById.mockResolvedValue(buildJob({ id: 'job-1', attempts: 1, maxAttempts: 3, status: 'processing' }));

    await createWorker(vi.fn().mockRejectedValue(new RetryableError('FFMPEG_TIMEOUT', 'slow'))).handle({
      data: { jobId: 'job-1' },
    });

    const retryAt = jobs.fail.mock.calls[0][3];
    expect(retryAt).toBeInstanceOf(Date);
    expect(dispatcher.dispatch).toHaveBeenCalledWith({ id: 'job-1', attempts: 1, runAfter: retryAt });
  });

  it('handle_WithPermanentFailure_DoesNotRedispatch', async () => {
    jobs.claimById.mockResolvedValue(buildJob({ id: 'job-1', attempts: 1, status: 'processing' }));

    await createWorker(vi.fn().mockRejectedValue(new PermanentError('BAD_INPUT', 'corrupt'))).handle({
      data: { jobId: 'job-1' },
    });

    expect(jobs.fail).toHaveBeenCalledWith('job-1', 'w1', expect.objectContaining({ code: 'BAD_INPUT' }), undefined);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('handle_WhenRedispatchFails_LogsAndLeavesItToTheReconciler', async () => {
    jobs.claimById.mockResolvedValue(buildJob({ id: 'job-1', attempts: 1, maxAttempts: 3, status: 'processing' }));
    dispatcher.dispatch.mockRejectedValue(new Error('redis down'));

    await expect(
      createWorker(vi.fn().mockRejectedValue(new RetryableError('STORAGE_ERROR', 'x'))).handle({ data: { jobId: 'job-1' } }),
    ).resolves.toBeUndefined();
    expect(silentLogger.warn).toHaveBeenCalledWith('dispatch failed; the reconciler will retry', expect.anything());
  });

  it('reconcile_RecoversStaleJobsAndDispatchesEveryRunnableQueuedJob', async () => {
    const queued = [buildJob({ id: 'a' }), buildJob({ id: 'b', attempts: 1 })];
    jobs.requeueStale.mockResolvedValue({ requeued: 1, failed: 0 });
    jobs.findDispatchable.mockResolvedValue(queued);

    await createWorker(vi.fn()).reconcile();

    expect(dispatcher.dispatch).toHaveBeenCalledTimes(2);
    expect(dispatcher.dispatch).toHaveBeenCalledWith(queued[0]);
    expect(dispatcher.dispatch).toHaveBeenCalledWith(queued[1]);
  });

  it('reconcile_WhenMongoFails_LogsInsteadOfThrowing', async () => {
    jobs.requeueStale.mockRejectedValue(new Error('mongo down'));

    await expect(createWorker(vi.fn()).reconcile()).resolves.toBeUndefined();
    expect(silentLogger.error).toHaveBeenCalledWith('job reconcile failed', { error: 'mongo down' });
  });
});
