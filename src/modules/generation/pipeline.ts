import { mkdtemp, rm, stat } from 'fs/promises';
import os from 'os';
import path from 'path';
import { StorageProvider } from '../../storage';
import type { Asset, AssetRepository } from '../asset';
import type { CompleteJobData, Job } from '../job/job.repository';
import { CaptionGenerator } from './caption.generator';
import { PermanentError, RetryableError } from './errors';
import { buildThumbnailArgs, buildTranscodeArgs } from './ffmpegCommand';
import { ProbeFn } from './ffprobe';
import { RunFfmpegFn } from './ffmpegRunner';
import { getPreset } from './platformPresets';

export interface PipelineDependencies {
  assets: AssetRepository;
  storage: StorageProvider;
  captions: CaptionGenerator;
  runFfmpeg: RunFfmpegFn;
  probe: ProbeFn;
  ffmpegTimeoutMs: number;
  outputTtlDays: number;
}

export interface PipelineContext {
  /** Persist progress; implementations throw JobCancelledError when the job was cancelled. */
  report(progress: number, stage: string): Promise<void>;
  signal: AbortSignal;
}

const STAGES = {
  downloading: [0, 5],
  transcoding: [5, 85],
  thumbnail: [85, 90],
  uploading: [90, 96],
  caption: [96, 99],
} as const;

async function storageCall<T>(action: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new RetryableError('STORAGE_ERROR', `Storage error while ${action}`, { cause: err });
  }
}

function outputName(input: Asset, platform: string, format: string, extension: string): string {
  const base = input.originalName.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').slice(0, 60) || 'content';
  return `${base}-${platform}-${format}.${extension}`;
}

export async function runGenerationPipeline(
  job: Job,
  deps: PipelineDependencies,
  ctx: PipelineContext,
): Promise<CompleteJobData> {
  const preset = getPreset(job.platform, job.format);
  if (!preset) throw new PermanentError('INVALID_PRESET', `Unknown format ${job.platform}/${job.format}`);

  const input = await deps.assets.findOne(job.inputAssetId);
  if (!input) throw new PermanentError('INPUT_MISSING', 'The input file has expired or was removed');

  const workDir = await mkdtemp(path.join(os.tmpdir(), `job-${job.id}-`));
  try {
    await ctx.report(STAGES.downloading[0], 'downloading');
    const inputPath = path.join(workDir, `input${path.extname(input.storageKey)}`);
    await storageCall('downloading the input', () => deps.storage.downloadToFile(input.storageKey, inputPath));

    await ctx.report(STAGES.transcoding[0], 'transcoding');
    const outputPath = path.join(workDir, 'output.mp4');
    const command = buildTranscodeArgs({
      inputPath,
      outputPath,
      preset,
      fit: job.options.fit,
      kind: input.kind,
      hasAudio: input.metadata.hasAudio,
      sourceDurationSeconds: input.metadata.durationSeconds,
      trimStartSeconds: job.options.trimStartSeconds,
    });

    let lastReported = 0;
    const pending: Promise<void>[] = [];
    await deps.runFfmpeg(command.args, {
      timeoutMs: deps.ffmpegTimeoutMs,
      totalDurationSeconds: command.durationSeconds,
      signal: ctx.signal,
      onProgress: (fraction) => {
        const [from, to] = STAGES.transcoding;
        const progress = from + (to - from) * fraction;
        if (progress - lastReported >= 2) {
          lastReported = progress;
          pending.push(ctx.report(progress, 'transcoding').catch(() => undefined));
        }
      },
    });
    await Promise.all(pending);

    await ctx.report(STAGES.thumbnail[0], 'creating thumbnail');
    const thumbPath = path.join(workDir, 'thumb.jpg');
    await deps.runFfmpeg(buildThumbnailArgs(outputPath, thumbPath, command.durationSeconds, preset.width), {
      timeoutMs: 60_000,
      signal: ctx.signal,
    });

    await ctx.report(STAGES.uploading[0], 'uploading');
    const [outputMeta, thumbMeta, outputStat, thumbStat] = await Promise.all([
      deps.probe(outputPath),
      deps.probe(thumbPath),
      stat(outputPath),
      stat(thumbPath),
    ]);
    const prefix = `outputs/${job.userId}/${job.id}`;
    const outputKey = `${prefix}/attempt-${job.attempts}.mp4`;
    const thumbKey = `${prefix}/attempt-${job.attempts}.jpg`;
    await storageCall('uploading the result', () =>
      Promise.all([
        deps.storage.putFile(outputKey, outputPath, 'video/mp4'),
        deps.storage.putFile(thumbKey, thumbPath, 'image/jpeg'),
      ]),
    );

    const expiresAt = new Date(Date.now() + deps.outputTtlDays * 24 * 60 * 60 * 1000);
    const common = { userId: job.userId, source: 'generated' as const, expiresAt };
    const [outputAsset, thumbAsset] = await Promise.all([
      deps.assets.create({
        ...common,
        kind: 'video',
        role: 'output',
        mimeType: 'video/mp4',
        originalName: outputName(input, job.platform, job.format, 'mp4'),
        size: outputStat.size,
        storageKey: outputKey,
        metadata: outputMeta,
      }),
      deps.assets.create({
        ...common,
        kind: 'image',
        role: 'thumbnail',
        mimeType: 'image/jpeg',
        originalName: outputName(input, job.platform, job.format, 'jpg'),
        size: thumbStat.size,
        storageKey: thumbKey,
        metadata: thumbMeta,
      }),
    ]);

    let caption;
    if (job.options.generateCaption) {
      await ctx.report(STAGES.caption[0], 'writing caption');
      caption = await deps.captions.generate({
        platform: job.platform,
        format: job.format,
        title: input.title,
        originalName: input.originalName,
        durationSeconds: outputMeta.durationSeconds,
      });
    }

    return { outputAssetId: outputAsset.id, thumbnailAssetId: thumbAsset.id, caption };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
