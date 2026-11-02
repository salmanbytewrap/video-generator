import { execFile } from 'child_process';
import { promisify } from 'util';
import { ffprobePath } from './binaries';

const execFileAsync = promisify(execFile);

export interface MediaMetadata {
  width: number;
  height: number;
  durationSeconds?: number;
  videoCodec?: string;
  audioCodec?: string;
  hasAudio: boolean;
  frameRate?: number;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string };
}

export type ProbeFn = (filePath: string) => Promise<MediaMetadata>;

function parseFrameRate(value?: string): number | undefined {
  if (!value) return undefined;
  const [num, den] = value.split('/').map(Number);
  return den ? Math.round((num / den) * 100) / 100 : undefined;
}

export function parseProbeOutput(output: FfprobeOutput): MediaMetadata {
  const streams = output.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  if (!video?.width || !video.height) throw new Error('No visual stream found');

  const rotation = Math.abs(Number(video.tags?.rotate ?? video.side_data_list?.[0]?.rotation ?? 0));
  const rotated = rotation === 90 || rotation === 270;
  const duration = Number(output.format?.duration);

  return {
    width: rotated ? video.height : video.width,
    height: rotated ? video.width : video.height,
    durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : undefined,
    videoCodec: video.codec_name,
    audioCodec: audio?.codec_name,
    hasAudio: Boolean(audio),
    frameRate: parseFrameRate(video.avg_frame_rate),
  };
}

export const probeMedia: ProbeFn = async (filePath) => {
  const { stdout } = await execFileAsync(
    ffprobePath(),
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
  );
  return parseProbeOutput(JSON.parse(stdout) as FfprobeOutput);
};
