import { MongoJobRepository } from '../../../src/modules/job';
import { JobModel } from '../../../src/modules/job/job.model';
import { CreateJobData } from '../../../src/modules/job/job.repository';
import { useInMemoryDatabase } from '../../support/db';
import { OTHER_USER_ID, USER_ID } from '../../support/mocks';

describe('MongoJobRepository', () => {
  useInMemoryDatabase();
  const repo = new MongoJobRepository();
  const LOCK = 60_000;

  const data = (overrides: Partial<CreateJobData> = {}): CreateJobData => ({
    userId: USER_ID,
    inputAssetId: '64b000000000000000000001',
    platform: 'tiktok',
    format: 'vertical',
    options: { fit: 'crop', trimStartSeconds: 0, generateCaption: true },
    maxAttempts: 2,
    ...overrides,
  });

  it('claimNext_WithManyConcurrentWorkers_ClaimsEachJobExactlyOnce', async () => {
    await Promise.all(Array.from({ length: 5 }, () => repo.create(data())));

    const claims = await Promise.all(Array.from({ length: 10 }, (_, i) => repo.claimNext(`w${i}`, LOCK)));
    const claimed = claims.filter(Boolean);

    expect(claimed).toHaveLength(5);
    expect(new Set(claimed.map((j) => j!.id)).size).toBe(5);
    expect(claimed.every((j) => j!.status === 'processing' && j!.attempts === 1)).toBe(true);
  });

  it('claimById_WithConcurrentDeliveries_ClaimsTheJobOnce', async () => {
    const job = await repo.create(data());

    const claims = await Promise.all(Array.from({ length: 5 }, (_, i) => repo.claimById(job.id, `w${i}`, LOCK)));

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)).toMatchObject({ id: job.id, status: 'processing', attempts: 1 });
  });

  it('claimById_WithNonQueuedOrInvalidJob_ReturnsNull', async () => {
    const job = await repo.create(data());
    await repo.requestCancel(job.id, USER_ID);

    expect(await repo.claimById(job.id, 'w1', LOCK)).toBeNull();
    expect(await repo.claimById('not-an-id', 'w1', LOCK)).toBeNull();
  });

  it('findDispatchable_ReturnsOnlyRunnableQueuedJobsOldestFirst', async () => {
    const first = await repo.create(data());
    const second = await repo.create(data());
    const later = await repo.create(data());
    const running = await repo.create(data());
    await JobModel.updateOne({ _id: later.id }, { runAfter: new Date(Date.now() + 60_000) });
    await repo.claimById(running.id, 'w1', LOCK);

    const ids = (await repo.findDispatchable()).map((j) => j.id);

    expect(ids).toEqual([first.id, second.id]);
  });

  it('claimNext_SkipsJobsScheduledForLater', async () => {
    const job = await repo.create(data());
    await JobModel.updateOne({ _id: job.id }, { runAfter: new Date(Date.now() + 60_000) });

    expect(await repo.claimNext('w1', LOCK)).toBeNull();
  });

  it('heartbeat_FromOwner_ExtendsLockAndRecordsProgress_OtherWorkerIsRejected', async () => {
    await repo.create(data());
    const job = (await repo.claimNext('w1', LOCK))!;

    expect(await repo.heartbeat(job.id, 'w1', LOCK, 42.4, 'transcoding')).toEqual({ alive: true, cancelRequested: false });
    expect(await repo.heartbeat(job.id, 'intruder', LOCK)).toEqual({ alive: false, cancelRequested: false });
    expect(await repo.findOne(job.id)).toMatchObject({ progress: 42, stage: 'transcoding' });
  });

  it('complete_SetsOutputAndClearsLock', async () => {
    await repo.create(data());
    const job = (await repo.claimNext('w1', LOCK))!;

    const ok = await repo.complete(job.id, 'w1', {
      outputAssetId: '64b0000000000000000000aa',
      caption: { text: 'Hi', hashtags: ['#a'], simulated: true },
    });

    expect(ok).toBe(true);
    expect(await repo.findOne(job.id)).toMatchObject({
      status: 'completed',
      progress: 100,
      outputAssetId: '64b0000000000000000000aa',
      caption: { text: 'Hi', hashtags: ['#a'], simulated: true },
      lockedBy: undefined,
    });
    expect(await repo.complete(job.id, 'w1', { outputAssetId: '64b0000000000000000000aa' })).toBe(false);
  });

  it('fail_WithRetryAt_RequeuesWithError_WithoutRetryAt_FailsTerminally', async () => {
    await repo.create(data());
    let job = (await repo.claimNext('w1', LOCK))!;
    const error = { code: 'STORAGE_ERROR', message: 'blip', retryable: true };

    await repo.fail(job.id, 'w1', error, new Date());
    expect(await repo.findOne(job.id)).toMatchObject({ status: 'queued', error });

    job = (await repo.claimNext('w1', LOCK))!;
    expect(job).toMatchObject({ attempts: 2, error: undefined });
    await repo.fail(job.id, 'w1', error);
    expect(await repo.findOne(job.id)).toMatchObject({ status: 'failed', completedAt: expect.any(Date) });
  });

  it('requeueStale_RequeuesExpiredLocks_AndFailsJobsOutOfAttempts', async () => {
    const a = await repo.create(data());
    const b = await repo.create(data());
    await repo.claimNext('w1', LOCK);
    await repo.claimNext('w2', LOCK);
    await JobModel.updateMany({}, { lockedUntil: new Date(Date.now() - 1000) });
    await JobModel.updateOne({ _id: b.id }, { attempts: 2 });

    const result = await repo.requeueStale();

    expect(result).toEqual({ requeued: 1, failed: 1 });
    expect(await repo.findOne(a.id)).toMatchObject({ status: 'queued', lockedBy: undefined });
    expect(await repo.findOne(b.id)).toMatchObject({ status: 'failed', error: { code: 'WORKER_LOST' } });
  });

  it('release_ReturnsJobToQueueWithoutConsumingAttempt', async () => {
    await repo.create(data());
    const job = (await repo.claimNext('w1', LOCK))!;

    expect(await repo.release(job.id, 'w1')).toBe(true);
    expect(await repo.findOne(job.id)).toMatchObject({ status: 'queued', attempts: 0 });
  });

  it('requestCancel_QueuedJobIsCancelled_ProcessingJobIsFlagged', async () => {
    const queued = await repo.create(data());
    await repo.create(data());
    const processing = (await repo.claimNext('w1', LOCK))!;

    const cancelledQueued = await repo.requestCancel(queued.id === processing.id ? (await repo.find())[1].id : queued.id, USER_ID);
    const flagged = await repo.requestCancel(processing.id, USER_ID);

    expect(cancelledQueued?.status).toBe('cancelled');
    expect(flagged).toMatchObject({ status: 'processing', cancelRequested: true });
    expect(await repo.heartbeat(processing.id, 'w1', LOCK)).toEqual({ alive: true, cancelRequested: true });
    expect(await repo.markCancelled(processing.id, 'w1')).toBe(true);
    expect(await repo.requestCancel(processing.id, OTHER_USER_ID)).toBeNull();
  });

  it('resetForRetry_OnlyResetsFailedOrCancelledJobsOfOwner', async () => {
    const job = await repo.create(data());
    expect(await repo.resetForRetry(job.id, USER_ID)).toBeNull();

    await JobModel.updateOne({ _id: job.id }, { status: 'failed', attempts: 2, error: { code: 'X', message: 'x', retryable: true } });

    expect(await repo.resetForRetry(job.id, OTHER_USER_ID)).toBeNull();
    expect(await repo.resetForRetry(job.id, USER_ID)).toMatchObject({ status: 'queued', attempts: 0, error: undefined });
    expect(await repo.resetForRetry('not-an-id', USER_ID)).toBeNull();
  });

  it('listForUser_And_countActiveForUser_AreScopedToOwner', async () => {
    await repo.create(data());
    await repo.create(data());
    await repo.create(data({ userId: OTHER_USER_ID }));

    const page = await repo.listForUser(USER_ID, 1, 1);

    expect(page).toMatchObject({ total: 2, page: 1, limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(await repo.countActiveForUser(USER_ID)).toBe(2);
    expect(await repo.findOneForUser(page.items[0].id, OTHER_USER_ID)).toBeNull();
  });

  it('idempotencyKey_IsUniquePerUser', async () => {
    await repo.create(data({ idempotencyKey: 'same-key-123' }));
    await repo.create(data({ userId: OTHER_USER_ID, idempotencyKey: 'same-key-123' }));

    await expect(repo.create(data({ idempotencyKey: 'same-key-123' }))).rejects.toMatchObject({ code: 11000 });
    expect(await repo.findByIdempotencyKey(USER_ID, 'same-key-123')).not.toBeNull();
  });
});
