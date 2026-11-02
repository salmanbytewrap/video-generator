import { Queue } from 'bullmq';
import config from './config';
import { redisConnection } from './config/redis';
import { AssetRepository, AssetService, MongoAssetRepository, UrlImportService } from './modules/asset';
import { probeMedia, ProbeFn } from './modules/generation/ffprobe';
import { JobRepository, JobService, MongoJobRepository } from './modules/job';
import { BullJobDispatcher, GenerateJobData, JobDispatcher, NoopJobDispatcher } from './modules/job/job.dispatcher';
import { MongoUserRepository, UserRepository } from './modules/user';
import { createStorage, StorageProvider } from './storage';

export interface AppDependencies {
  userRepository: UserRepository;
  assetRepository: AssetRepository;
  jobRepository: JobRepository;
  storage: StorageProvider;
  probe: ProbeFn;
  jobDispatcher: JobDispatcher;
  /** Only tests set this, to import from a local HTTP server. */
  allowPrivateNetworkImports: boolean;
}

export interface Services {
  assetService: AssetService;
  urlImportService: UrlImportService;
  jobService: JobService;
}

export function createDependencies(overrides: Partial<AppDependencies> = {}): AppDependencies {
  return {
    userRepository: overrides.userRepository ?? new MongoUserRepository(),
    assetRepository: overrides.assetRepository ?? new MongoAssetRepository(),
    jobRepository: overrides.jobRepository ?? new MongoJobRepository(),
    storage: overrides.storage ?? createStorage(),
    probe: overrides.probe ?? probeMedia,
    jobDispatcher: overrides.jobDispatcher ?? createJobDispatcher(),
    allowPrivateNetworkImports: overrides.allowPrivateNetworkImports ?? false,
  };
}

export function createJobDispatcher(): JobDispatcher {
  if (config.QUEUE_DRIVER !== 'bullmq') return new NoopJobDispatcher();
  return new BullJobDispatcher(new Queue<GenerateJobData>(config.BULLMQ_QUEUE_NAME, { connection: redisConnection() }));
}

export function createServices(deps: AppDependencies): Services {
  const assetService = new AssetService(deps.assetRepository, deps.storage, deps.probe, {
    maxVideoSeconds: config.MAX_VIDEO_SECONDS,
    ttlDays: config.OUTPUT_TTL_DAYS,
  });
  return {
    assetService,
    urlImportService: new UrlImportService(assetService, {
      maxMediaBytes: config.UPLOAD_MAX_BYTES,
      timeoutMs: config.URL_IMPORT_TIMEOUT_MS,
      allowPrivateNetwork: deps.allowPrivateNetworkImports,
    }),
    jobService: new JobService(deps.jobRepository, deps.assetRepository, deps.storage, {
      maxAttempts: config.MAX_ATTEMPTS,
      maxActiveJobsPerUser: config.MAX_ACTIVE_JOBS_PER_USER,
    }, deps.jobDispatcher),
  };
}
