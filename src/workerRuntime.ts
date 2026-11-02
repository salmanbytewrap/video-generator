import os from 'os';
import config from './config';
import { AppDependencies } from './container';
import { cleanupExpiredAssets } from './modules/asset/asset.cleanup';
import { SimulatedCaptionGenerator } from './modules/generation/caption.generator';
import { runFfmpeg } from './modules/generation/ffmpegRunner';
import { runGenerationPipeline } from './modules/generation/pipeline';
import { JobWorker } from './modules/job/job.worker';

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export interface WorkerRuntime {
  stop(): Promise<void>;
}

export function startWorkerRuntime(deps: AppDependencies): WorkerRuntime {
  const pipelineDeps = {
    assets: deps.assetRepository,
    storage: deps.storage,
    captions: new SimulatedCaptionGenerator(),
    runFfmpeg,
    probe: deps.probe,
    ffmpegTimeoutMs: config.FFMPEG_TIMEOUT_MS,
    outputTtlDays: config.OUTPUT_TTL_DAYS,
  };

  const worker = new JobWorker(deps.jobRepository, (job, ctx) => runGenerationPipeline(job, pipelineDeps, ctx), {
    workerId: `${os.hostname()}:${process.pid}`,
    concurrency: config.WORKER_CONCURRENCY,
    pollIntervalMs: config.WORKER_POLL_MS,
    lockMs: config.JOB_LOCK_MS,
  });
  worker.start();

  const runCleanup = () =>
    cleanupExpiredAssets(deps.assetRepository, deps.storage)
      .then((removed) => removed && console.info('removed expired assets', { removed }))
      .catch((err) => console.error('asset cleanup failed', { error: (err as Error).message }));
  const cleanupTimer = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
  void runCleanup();

  return {
    async stop() {
      clearInterval(cleanupTimer);
      await worker.stop();
    },
  };
}
