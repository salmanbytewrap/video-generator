import { Queue } from 'bullmq';
import { RetryableError } from '../../../src/modules/generation/errors';
import { MongoJobRepository } from '../../../src/modules/job';
import { BullJobWorker } from '../../../src/modules/job/bullmq.worker';
import { BullJobDispatcher, GenerateJobData } from '../../../src/modules/job/job.dispatcher';
import { JobProcessor } from '../../../src/modules/job/job.executor';
import { useInMemoryDatabase } from '../../support/db';
import { USER_ID } from '../../support/mocks';
import { redisAvailable, useRedisServer } from '../../support/redis';

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const result = { outputAssetId: '64b0000000000000000000aa', thumbnailAssetId: '64b0000000000000000000bb' };

describe.skipIf(!redisAvailable)('BullMQ queue driver (real Redis)', () => {
  useInMemoryDatabase();
  const redis = useRedisServer();
  const repo = new MongoJobRepository();
  let queue: Queue<GenerateJobData>;
  let dispatcher: BullJobDispatcher;
  let worker: BullJobWorker | undefined;

  beforeEach(() => {
    queue = new Queue<GenerateJobData>(`test-${Date.now()}-${Math.random().toString(36).slice(2)}`, {
      connection: { url: redis.url(), maxRetriesPerRequest: null },
    });
    dispatcher = new BullJobDispatcher(queue);
  });

  afterEach(async () => {
    await worker?.stop();
    worker = undefined;
    await queue.obliterate({ force: true });
    await dispatcher.close();
  });

  function startWorker(processor: JobProcessor, reconcileIntervalMs = 60_000) {
    worker = new BullJobWorker(
      repo,
      processor,
      dispatcher,
      {
        queueName: queue.name,
        connection: { url: redis.url(), maxRetriesPerRequest: null },
        workerId: 'it-worker',
        concurrency: 2,
        lockMs: 5_000,
        backoffBaseMs: 200,
        backoffMaxMs: 200,
        reconcileIntervalMs,
        shutdownGraceMs: 1_000,
      },
      silentLogger,
    );
    worker.start();
  }

  const createJob = () =>
    repo.create({
      userId: USER_ID,
      inputAssetId: '64b000000000000000000001',
      platform: 'tiktok',
      format: 'vertical',
      options: { fit: 'crop', trimStartSeconds: 0, generateCaption: true },
      maxAttempts: 3,
    });

  const waitForStatus = (id: string, status: string) =>
    vi.waitFor(
      async () => {
        expect((await repo.findOne(id))?.status).toBe(status);
      },
      { timeout: 10_000, interval: 50 },
    );

  it('processes a dispatched job to completion', async () => {
    const processor = vi.fn().mockResolvedValue(result);
    startWorker(processor);
    const job = await createJob();

    await dispatcher.dispatch(job);
    await waitForStatus(job.id, 'completed');

    expect(processor).toHaveBeenCalledTimes(1);
    expect((await repo.findOne(job.id))?.outputAssetId).toBe(result.outputAssetId);
  });

  it('ignores duplicate dispatches of the same attempt', async () => {
    const processor = vi.fn().mockResolvedValue(result);
    const job = await createJob();

    await Promise.all([dispatcher.dispatch(job), dispatcher.dispatch(job), dispatcher.dispatch(job)]);
    expect(await queue.count()).toBe(1);
    startWorker(processor);
    await waitForStatus(job.id, 'completed');

    expect(processor).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable failure through a delayed message and then succeeds', async () => {
    const processor = vi
      .fn()
      .mockRejectedValueOnce(new RetryableError('FFMPEG_TIMEOUT', 'slow'))
      .mockResolvedValue(result);
    startWorker(processor);
    const job = await createJob();

    await dispatcher.dispatch(job);
    await waitForStatus(job.id, 'completed');

    expect(processor).toHaveBeenCalledTimes(2);
    expect((await repo.findOne(job.id))?.attempts).toBe(2);
  });

  it('reconciler dispatches queued jobs whose message was never enqueued', async () => {
    const processor = vi.fn().mockResolvedValue(result);
    const job = await createJob();

    startWorker(processor, 100);
    await waitForStatus(job.id, 'completed');

    expect(processor).toHaveBeenCalledTimes(1);
  });

  it('skips messages for jobs that were cancelled while queued', async () => {
    const processor = vi.fn().mockResolvedValue(result);
    const job = await createJob();
    await dispatcher.dispatch(job);
    await repo.requestCancel(job.id, USER_ID);

    startWorker(processor);
    await vi.waitFor(async () => expect(await queue.count()).toBe(0), { timeout: 10_000, interval: 50 });

    expect(processor).not.toHaveBeenCalled();
    expect((await repo.findOne(job.id))?.status).toBe('cancelled');
  });
});
