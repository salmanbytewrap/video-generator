import { buildFitFilter, buildThumbnailArgs, buildTranscodeArgs, TranscodeInput } from '../../../src/modules/generation/ffmpegCommand';
import { getPreset } from '../../../src/modules/generation/platformPresets';

const vertical = getPreset('tiktok', 'vertical')!;
const short = getPreset('youtube', 'short')!;

function build(overrides: Partial<TranscodeInput> = {}) {
  return buildTranscodeArgs({
    inputPath: '/in.mp4',
    outputPath: '/out.mp4',
    preset: vertical,
    fit: 'crop',
    kind: 'video',
    hasAudio: true,
    sourceDurationSeconds: 20,
    ...overrides,
  });
}

const valueAfter = (args: string[], flag: string, from = 0) => args[args.indexOf(flag, from) + 1];

describe('ffmpegCommand', () => {
  it('buildFitFilter_Crop_ScalesToCoverThenCrops', () => {
    expect(buildFitFilter(vertical, 'crop')).toBe(
      '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[fit]',
    );
  });

  it('buildFitFilter_Blur_OverlaysContainedVideoOnBlurredBackground', () => {
    const filter = buildFitFilter(vertical, 'blur');
    expect(filter).toContain('split=2');
    expect(filter).toContain('boxblur');
    expect(filter).toContain('force_original_aspect_ratio=decrease');
    expect(filter).toContain('overlay=(W-w)/2:(H-h)/2[fit]');
  });

  it('buildTranscodeArgs_VideoWithAudio_MapsSourceAudioAndEncodesH264Aac', () => {
    const { args, durationSeconds } = build();

    expect(durationSeconds).toBe(20);
    expect(valueAfter(args, '-map', args.indexOf('-map') + 1)).toBe('0:a:0');
    expect(valueAfter(args, '-c:v')).toBe('libx264');
    expect(valueAfter(args, '-c:a')).toBe('aac');
    expect(valueAfter(args, '-r')).toBe('30');
    expect(args).toContain('+faststart');
    expect(args.slice(-1)[0]).toBe('/out.mp4');
    expect(args).not.toContain('-ss');
  });

  it('buildTranscodeArgs_LongVideo_CapsDurationAtPlatformMaximum', () => {
    const { durationSeconds } = build({ preset: short, sourceDurationSeconds: 300 });

    expect(durationSeconds).toBe(60);
  });

  it('buildTranscodeArgs_WithTrimStart_SeeksAndShortensDuration', () => {
    const { args, durationSeconds } = build({ trimStartSeconds: 5 });

    expect(valueAfter(args, '-ss')).toBe('5');
    expect(durationSeconds).toBe(15);
  });

  it('buildTranscodeArgs_TrimPastEnd_Throws', () => {
    expect(() => build({ trimStartSeconds: 25 })).toThrow('Nothing to render');
  });

  it('buildTranscodeArgs_SilentVideo_AddsSilentAudioTrack', () => {
    const { args } = build({ hasAudio: false });

    expect(args).toContain('anullsrc=channel_layout=stereo:sample_rate=48000');
    expect(args).toContain('1:a:0');
  });

  it('buildTranscodeArgs_ImageWithMotion_UsesZoompanOnSingleFrame', () => {
    const { args, durationSeconds } = build({ kind: 'image', hasAudio: false, sourceDurationSeconds: undefined });

    expect(durationSeconds).toBe(vertical.imageClipSeconds);
    expect(valueAfter(args, '-filter_complex')).toContain('zoompan=');
    expect(args).not.toContain('-loop');
  });

  it('buildTranscodeArgs_ImageWithoutMotion_LoopsStillFrame', () => {
    const { args } = build({ kind: 'image', hasAudio: true, motion: false });

    expect(args).toContain('-loop');
    expect(valueAfter(args, '-filter_complex')).not.toContain('zoompan');
    expect(args).toContain('1:a:0');
  });

  it('buildThumbnailArgs_ShortVideo_SeeksToMiddleAndScalesToThirdWidth', () => {
    const args = buildThumbnailArgs('/v.mp4', '/t.jpg', 1, 1080);

    expect(valueAfter(args, '-ss')).toBe('0.5');
    expect(valueAfter(args, '-vf')).toBe('scale=360:-2');
    expect(args.slice(-1)[0]).toBe('/t.jpg');
  });
});
