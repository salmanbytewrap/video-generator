import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import ffmpegStatic from 'ffmpeg-static';
import config from '../../config';

export function ffmpegPath(): string {
  const resolved = config.FFMPEG_PATH ?? ffmpegStatic;
  if (!resolved) throw new Error('ffmpeg binary not found; set FFMPEG_PATH');
  return resolved;
}

export function ffprobePath(): string {
  return config.FFPROBE_PATH ?? ffprobeInstaller.path;
}
