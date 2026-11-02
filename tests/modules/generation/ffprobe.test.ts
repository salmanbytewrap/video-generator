import { parseProbeOutput, probeMedia } from '../../../src/modules/generation/ffprobe';
import { createSampleVideo, hasFfmpeg, makeTempDir } from '../../support/media';

describe('ffprobe', () => {
  it('parseProbeOutput_VideoWithAudio_ReturnsMetadata', () => {
    const meta = parseProbeOutput({
      streams: [
        { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30000/1001' },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
      format: { duration: '12.5' },
    });

    expect(meta).toEqual({
      width: 1920,
      height: 1080,
      durationSeconds: 12.5,
      videoCodec: 'h264',
      audioCodec: 'aac',
      hasAudio: true,
      frameRate: 29.97,
    });
  });

  it('parseProbeOutput_RotatedPhoneVideo_SwapsDimensions', () => {
    const meta = parseProbeOutput({
      streams: [{ codec_type: 'video', width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }],
      format: {},
    });

    expect(meta).toMatchObject({ width: 1080, height: 1920, hasAudio: false, durationSeconds: undefined });
  });

  it('parseProbeOutput_WithoutVisualStream_Throws', () => {
    expect(() => parseProbeOutput({ streams: [{ codec_type: 'audio' }] })).toThrow('No visual stream');
  });

  it.skipIf(!hasFfmpeg)('probeMedia_OnRealFile_ReadsDimensionsAndDuration', async () => {
    const { dir, cleanup } = await makeTempDir();
    try {
      const file = await createSampleVideo(`${dir}/v.mp4`, { width: 320, height: 240, seconds: 1 });
      const meta = await probeMedia(file);

      expect(meta).toMatchObject({ width: 320, height: 240, hasAudio: true, videoCodec: 'h264' });
      expect(meta.durationSeconds).toBeCloseTo(1, 0);
    } finally {
      await cleanup();
    }
  });
});
