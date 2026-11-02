import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { ffmpegPath } from '../../src/modules/generation/binaries';

const execFileAsync = promisify(execFile);

export const hasFfmpeg = (() => {
  try {
    return existsSync(ffmpegPath());
  } catch {
    return false;
  }
})();

export async function makeTempDir(prefix = 'vg-test-'): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export interface SampleVideoOptions {
  width?: number;
  height?: number;
  seconds?: number;
  audio?: boolean;
}

export async function createSampleVideo(filePath: string, options: SampleVideoOptions = {}): Promise<string> {
  const { width = 320, height = 180, seconds = 2, audio = true } = options;
  const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=${width}x${height}:rate=15`];
  if (audio) args.push('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000');
  args.push('-t', String(seconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p');
  if (audio) args.push('-c:a', 'aac', '-shortest');
  args.push(filePath);
  await execFileAsync(ffmpegPath(), args);
  return filePath;
}

export async function createSampleImage(filePath: string, width = 400, height = 300): Promise<string> {
  await execFileAsync(ffmpegPath(), ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=${width}x${height}`, '-frames:v', '1', filePath]);
  return filePath;
}
