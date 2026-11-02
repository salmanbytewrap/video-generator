import { MongoAssetRepository } from '../../../src/modules/asset';
import { cleanupExpiredAssets } from '../../../src/modules/asset/asset.cleanup';
import { SimulatedCaptionGenerator } from '../../../src/modules/generation/caption.generator';
import { JobCancelledError } from '../../../src/modules/generation/errors';
import { runFfmpeg } from '../../../src/modules/generation/ffmpegRunner';
import { probeMedia } from '../../../src/modules/generation/ffprobe';
import { PipelineDependencies, runGenerationPipeline } from '../../../src/modules/generation/pipeline';
import { LocalStorage } from '../../../src/storage';
import { useInMemoryDatabase } from '../../support/db';
import { createSampleImage, createSampleVideo, hasFfmpeg, makeTempDir } from '../../support/media';
import { buildJob, USER_ID } from '../../support/mocks';

describe.skipIf(!hasFfmpeg)('runGenerationPipeline (real ffmpeg)', () => {
  useInMemoryDatabase();
  const assets = new MongoAssetRepository();
  let dir: string;
  let cleanup: () => Promise<void>;
  let deps: PipelineDependencies;
  let storage: LocalStorage;

  beforeAll(async () => {
    ({ dir, cleanup } = await makeTempDir());
    storage = new LocalStorage(`${dir}/storage`, 'secret', 60);
    deps = {
      assets,
      storage,
      captions: new SimulatedCaptionGenerator(),
      runFfmpeg,
      probe: probeMedia,
      ffmpegTimeoutMs: 60_000,
      outputTtlDays: 7,
    };
  });

  afterAll(() => cleanup());

  async function storeInput(file: string, kind: 'video' | 'image', mimeType: string) {
    const key = `uploads/${USER_ID}/${kind}-${Date.now()}`;
    await storage.putFile(key, file);
    return assets.create({
      userId: USER_ID,
      kind,
      role: 'input',
      mimeType,
      originalName: kind === 'video' ? 'Trail Shoes.mp4' : 'Desk Lamp.png',
      size: 1,
      storageKey: key,
      source: 'upload',
      metadata: await probeMedia(file),
    });
  }

  it('converts a landscape video to a 9:16 MP4 with thumbnail, caption and progress', async () => {
    const input = await storeInput(await createSampleVideo(`${dir}/in.mp4`, { width: 640, height: 360, seconds: 2 }), 'video', 'video/mp4');
    const report = vi.fn().mockResolvedValue(undefined);

    const result = await runGenerationPipeline(
      buildJob({ inputAssetId: input.id, platform: 'tiktok', format: 'vertical', attempts: 1, options: { fit: 'blur', trimStartSeconds: 0, generateCaption: true } }),
      deps,
      { report, signal: new AbortController().signal },
    );

    const output = (await assets.findOne(result.outputAssetId))!;
    expect(output).toMatchObject({
      role: 'output',
      mimeType: 'video/mp4',
      originalName: 'Trail-Shoes-tiktok-vertical.mp4',
      metadata: { width: 1080, height: 1920, videoCodec: 'h264', audioCodec: 'aac' },
    });
    expect(output.metadata.durationSeconds).toBeCloseTo(2, 0);
    expect(await assets.findOne(result.thumbnailAssetId!)).toMatchObject({ role: 'thumbnail', mimeType: 'image/jpeg' });
    expect(result.caption).toMatchObject({ simulated: true, text: expect.stringContaining('Trail Shoes') });
    expect(report.mock.calls.map(([, stage]) => stage)).toEqual(
      expect.arrayContaining(['downloading', 'transcoding', 'creating thumbnail', 'uploading', 'writing caption']),
    );
  });

  it('turns an image into a square video clip without a caption when disabled', async () => {
    const input = await storeInput(await createSampleImage(`${dir}/in.png`, 600, 400), 'image', 'image/png');

    const result = await runGenerationPipeline(
      buildJob({ inputAssetId: input.id, platform: 'instagram', format: 'square', options: { fit: 'crop', trimStartSeconds: 0, generateCaption: false } }),
      deps,
      { report: async () => undefined, signal: new AbortController().signal },
    );

    expect((await assets.findOne(result.outputAssetId))!.metadata).toMatchObject({ width: 1080, height: 1080 });
    expect(result.caption).toBeUndefined();
  });

  it('fails permanently when the input asset is gone', async () => {
    await expect(
      runGenerationPipeline(buildJob({ inputAssetId: '64b00000000000000000ffff' }), deps, {
        report: async () => undefined,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'INPUT_MISSING', retryable: false });
  });

  it('fails with a retryable storage error when the input file cannot be downloaded', async () => {
    const input = await assets.create({
      userId: USER_ID, kind: 'video', role: 'input', mimeType: 'video/mp4', originalName: 'x.mp4', size: 1,
      storageKey: `uploads/${USER_ID}/missing.mp4`, source: 'upload',
      metadata: { width: 640, height: 360, durationSeconds: 2, hasAudio: false },
    });

    await expect(
      runGenerationPipeline(buildJob({ inputAssetId: input.id }), deps, { report: async () => undefined, signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: 'STORAGE_ERROR', retryable: true });
  });

  it('stops when the job is cancelled', async () => {
    const input = await storeInput(await createSampleVideo(`${dir}/cancel.mp4`), 'video', 'video/mp4');
    const report = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new JobCancelledError());

    await expect(
      runGenerationPipeline(buildJob({ inputAssetId: input.id }), deps, { report, signal: new AbortController().signal }),
    ).rejects.toBeInstanceOf(JobCancelledError);
  });

  it('cleanupExpiredAssets removes expired files and records', async () => {
    const input = await storeInput(await createSampleVideo(`${dir}/old.mp4`), 'video', 'video/mp4');
    await assets.update(input.id, { expiresAt: new Date(Date.now() - 1000) });

    const removed = await cleanupExpiredAssets(assets, storage);

    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await assets.findOne(input.id)).toBeNull();
  });
});
