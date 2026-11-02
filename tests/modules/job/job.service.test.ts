import type { Mocked } from 'vitest';
import { ZodError } from 'zod';
import { AssetRepository } from '../../../src/modules/asset';
import { JobRepository, JobService } from '../../../src/modules/job';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  TooManyRequestsError,
} from '../../../src/utils/AppError';
import {
  buildAsset,
  buildJob,
  createMockAssetRepository,
  createMockJobRepository,
  createMockStorage,
  USER_ID,
} from '../../support/mocks';

const input = { inputAssetId: '64b000000000000000000001', platform: 'tiktok', format: 'vertical' };

describe('JobService', () => {
  let jobs: Mocked<JobRepository>;
  let assets: Mocked<AssetRepository>;
  let service: JobService;

  beforeEach(() => {
    jobs = createMockJobRepository();
    assets = createMockAssetRepository();
    service = new JobService(jobs, assets, createMockStorage(), { maxAttempts: 3, maxActiveJobsPerUser: 2 });
    assets.findOneForUser.mockResolvedValue(buildAsset());
    assets.findOne.mockResolvedValue(buildAsset());
    jobs.countActiveForUser.mockResolvedValue(0);
    jobs.create.mockImplementation(async (data) => buildJob({ ...data, id: 'job-1' }));
  });

  describe('createJob', () => {
    it('createJob_WithValidInput_QueuesJobWithDefaultsAndMaxAttempts', async () => {
      const { job, created } = await service.createJob(USER_ID, input);

      expect(created).toBe(true);
      expect(jobs.create).toHaveBeenCalledWith({
        userId: USER_ID,
        inputAssetId: input.inputAssetId,
        platform: 'tiktok',
        format: 'vertical',
        options: { fit: 'crop', trimStartSeconds: 0, generateCaption: true },
        maxAttempts: 3,
        idempotencyKey: undefined,
      });
      expect(job).toMatchObject({ id: 'job-1', status: 'queued', preset: { width: 1080, height: 1920 } });
      expect(job.input?.url).toContain('https://files.test/');
    });

    it('createJob_WithFormatNotOfferedByPlatform_ThrowsValidationError', async () => {
      await expect(service.createJob(USER_ID, { ...input, format: 'landscape' })).rejects.toBeInstanceOf(ZodError);
    });

    it('createJob_WithSomeoneElsesAsset_ThrowsNotFound', async () => {
      assets.findOneForUser.mockResolvedValue(null);

      await expect(service.createJob(USER_ID, input)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('createJob_WithGeneratedOutputAsInput_ThrowsNotFound', async () => {
      assets.findOneForUser.mockResolvedValue(buildAsset({ role: 'output' }));

      await expect(service.createJob(USER_ID, input)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('createJob_WithTrimPastEnd_ThrowsBadRequest', async () => {
      await expect(
        service.createJob(USER_ID, { ...input, options: { trimStartSeconds: 10 } }),
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it('createJob_AtActiveJobLimit_ThrowsTooManyRequests', async () => {
      jobs.countActiveForUser.mockResolvedValue(2);

      await expect(service.createJob(USER_ID, input)).rejects.toBeInstanceOf(TooManyRequestsError);
      expect(jobs.create).not.toHaveBeenCalled();
    });

    it('createJob_WithKnownIdempotencyKey_ReturnsExistingJobWithoutCreating', async () => {
      jobs.findByIdempotencyKey.mockResolvedValue(buildJob({ id: 'existing' }));

      const { job, created } = await service.createJob(USER_ID, input, 'request-key-1');

      expect(created).toBe(false);
      expect(job.id).toBe('existing');
      expect(jobs.create).not.toHaveBeenCalled();
    });

    it('createJob_WhenConcurrentRequestWinsRace_ReturnsTheWinner', async () => {
      jobs.findByIdempotencyKey.mockResolvedValueOnce(null).mockResolvedValueOnce(buildJob({ id: 'winner' }));
      jobs.create.mockRejectedValue(Object.assign(new Error('E11000'), { code: 11000 }));

      const { job, created } = await service.createJob(USER_ID, input, 'request-key-1');

      expect(created).toBe(false);
      expect(job.id).toBe('winner');
    });

    it('createJob_WhenCreateFailsForOtherReasons_Rethrows', async () => {
      jobs.create.mockRejectedValue(new Error('db down'));

      await expect(service.createJob(USER_ID, input, 'request-key-1')).rejects.toThrow('db down');
    });

    it('createJob_WithMalformedIdempotencyKey_ThrowsBadRequest', async () => {
      await expect(service.createJob(USER_ID, input, 'bad key!')).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('retry, cancel and output', () => {
    it('retryJob_ForFailedJob_ResetsIt', async () => {
      jobs.findOneForUser.mockResolvedValue(buildJob({ status: 'failed' }));
      jobs.resetForRetry.mockResolvedValue(buildJob({ status: 'queued' }));

      await expect(service.retryJob(USER_ID, 'job-1')).resolves.toMatchObject({ status: 'queued' });
    });

    it.each(['queued', 'processing', 'completed'] as const)('retryJob_For%sJob_ThrowsConflict', async (status) => {
      jobs.findOneForUser.mockResolvedValue(buildJob({ status }));

      await expect(service.retryJob(USER_ID, 'job-1')).rejects.toBeInstanceOf(ConflictError);
    });

    it('retryJob_AtActiveLimit_ThrowsTooManyRequests', async () => {
      jobs.findOneForUser.mockResolvedValue(buildJob({ status: 'failed' }));
      jobs.countActiveForUser.mockResolvedValue(2);

      await expect(service.retryJob(USER_ID, 'job-1')).rejects.toBeInstanceOf(TooManyRequestsError);
    });

    it('retryJob_WhenStateChangedConcurrently_ThrowsConflict', async () => {
      jobs.findOneForUser.mockResolvedValue(buildJob({ status: 'failed' }));
      jobs.resetForRetry.mockResolvedValue(null);

      await expect(service.retryJob(USER_ID, 'job-1')).rejects.toBeInstanceOf(ConflictError);
    });

    it('cancelJob_ForProcessingJob_RequestsCancellation', async () => {
      jobs.findOneForUser.mockResolvedValue(buildJob({ status: 'processing' }));
      jobs.requestCancel.mockResolvedValue(buildJob({ status: 'processing', cancelRequested: true }));

      await service.cancelJob(USER_ID, 'job-1');

      expect(jobs.requestCancel).toHaveBeenCalledWith('job-1', USER_ID);
    });

    it('cancelJob_ForCompletedJob_ThrowsConflict', async () => {
      jobs.findOneForUser.mockResolvedValue(buildJob({ status: 'completed' }));

      await expect(service.cancelJob(USER_ID, 'job-1')).rejects.toBeInstanceOf(ConflictError);
    });

    it('getJob_ForUnknownJob_ThrowsNotFound', async () => {
      jobs.findOneForUser.mockResolvedValue(null);

      await expect(service.getJob(USER_ID, 'nope')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('getOutputUrl_BeforeCompletion_ThrowsConflict', async () => {
      jobs.findOneForUser.mockResolvedValue(buildJob({ status: 'processing' }));

      await expect(service.getOutputUrl(USER_ID, 'job-1', 'download')).rejects.toBeInstanceOf(ConflictError);
    });

    it('getOutputUrl_WhenOutputExpired_ThrowsNotFound', async () => {
      jobs.findOneForUser.mockResolvedValue(buildJob({ status: 'completed', outputAssetId: 'out' }));
      assets.findOne.mockResolvedValue(null);

      await expect(service.getOutputUrl(USER_ID, 'job-1', 'preview')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('getJob_WhenCompleted_IncludesOutputDownloadAndThumbnailUrls', async () => {
      jobs.findOneForUser.mockResolvedValue(
        buildJob({ status: 'completed', outputAssetId: 'out', thumbnailAssetId: 'thumb' }),
      );
      assets.findOne.mockImplementation(async (id) =>
        buildAsset({ id, role: id === 'thumb' ? 'thumbnail' : 'output', storageKey: `outputs/${id}` }),
      );

      const view = await service.getJob(USER_ID, 'job-1');

      expect(view.output).toMatchObject({ url: 'https://files.test/outputs/out', downloadUrl: 'https://files.test/outputs/out' });
      expect(view.thumbnailUrl).toBe('https://files.test/outputs/thumb');
    });

    it('listJobs_ParsesPaginationAndMapsViews', async () => {
      jobs.listForUser.mockResolvedValue({ items: [buildJob()], total: 1, page: 2, limit: 5 });

      const page = await service.listJobs(USER_ID, { page: '2', limit: '5' });

      expect(jobs.listForUser).toHaveBeenCalledWith(USER_ID, 2, 5);
      expect(page.items[0]).toMatchObject({ status: 'queued' });
    });
  });
});
