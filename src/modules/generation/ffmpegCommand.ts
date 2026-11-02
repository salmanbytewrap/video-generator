import { FitMode, PlatformPreset } from './platformPresets';

export interface TranscodeInput {
  inputPath: string;
  outputPath: string;
  preset: PlatformPreset;
  fit: FitMode;
  kind: 'video' | 'image';
  hasAudio: boolean;
  sourceDurationSeconds?: number;
  trimStartSeconds?: number;
  /** Apply a slow zoom to still images (Ken Burns). */
  motion?: boolean;
}

export interface TranscodeCommand {
  args: string[];
  durationSeconds: number;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Builds the filter that fits the source into WxH, labelled [fit]. */
export function buildFitFilter(preset: PlatformPreset, fit: FitMode): string {
  const { width: w, height: h } = preset;
  if (fit === 'crop') {
    return `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1[fit]`;
  }
  // Blur fill: blur a small cover-scaled copy (cheap), upscale it, then overlay the contained original.
  const bw = even(w / 8);
  const bh = even(h / 8);
  return [
    `[0:v]split=2[bgsrc][fgsrc]`,
    `[bgsrc]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},boxblur=8:2,scale=${w}:${h},setsar=1[bg]`,
    `[fgsrc]scale=${w}:${h}:force_original_aspect_ratio=decrease,setsar=1[fg]`,
    `[bg][fg]overlay=(W-w)/2:(H-h)/2[fit]`,
  ].join(';');
}

export function buildTranscodeArgs(input: TranscodeInput): TranscodeCommand {
  const { preset } = input;
  const trimStart = input.kind === 'video' ? Math.max(0, input.trimStartSeconds ?? 0) : 0;
  const available =
    input.kind === 'video'
      ? Math.max(0, (input.sourceDurationSeconds ?? preset.maxDurationSeconds) - trimStart)
      : preset.imageClipSeconds;
  const duration = round3(Math.min(available, preset.maxDurationSeconds));
  if (duration <= 0) throw new Error('Nothing to render: trim start is past the end of the video');

  const frames = Math.round(duration * preset.fps);
  const zoom = input.kind === 'image' && input.motion !== false;
  let videoGraph = `${buildFitFilter(preset, input.fit)};[fit]`;
  if (zoom) {
    videoGraph +=
      `zoompan=z='min(1+0.15*on/${frames},1.15)':d=${frames}` +
      `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${preset.width}x${preset.height}:fps=${preset.fps},`;
  }
  videoGraph += `fps=${preset.fps},format=yuv420p[v]`;

  const args = ['-hide_banner', '-nostdin', '-y'];
  if (input.kind === 'video') {
    if (trimStart > 0) args.push('-ss', String(round3(trimStart)));
    args.push('-t', String(duration), '-i', input.inputPath);
  } else if (zoom) {
    args.push('-i', input.inputPath);
  } else {
    args.push('-loop', '1', '-framerate', String(preset.fps), '-t', String(duration), '-i', input.inputPath);
  }

  const useSourceAudio = input.kind === 'video' && input.hasAudio;
  if (!useSourceAudio) {
    args.push('-f', 'lavfi', '-t', String(duration), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
  }

  args.push(
    '-filter_complex', videoGraph,
    '-map', '[v]',
    '-map', useSourceAudio ? '0:a:0' : '1:a:0',
    '-c:v', preset.videoCodec,
    '-preset', 'veryfast',
    '-profile:v', 'high',
    '-crf', String(preset.crf),
    '-maxrate', preset.maxBitrate,
    '-bufsize', `${parseInt(preset.maxBitrate, 10) * 2}M`,
    '-r', String(preset.fps),
    '-c:a', preset.audioCodec,
    '-b:a', preset.audioBitrate,
    '-ar', '48000',
    '-ac', '2',
    '-t', String(duration),
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    '-nostats',
    input.outputPath,
  );

  return { args, durationSeconds: duration };
}

export function buildThumbnailArgs(videoPath: string, outputPath: string, durationSeconds: number, width: number): string[] {
  const at = round3(Math.min(1, durationSeconds / 2));
  return [
    '-hide_banner', '-nostdin', '-y',
    '-ss', String(at),
    '-i', videoPath,
    '-frames:v', '1',
    '-vf', `scale=${even(width / 3)}:-2`,
    '-q:v', '4',
    outputPath,
  ];
}
