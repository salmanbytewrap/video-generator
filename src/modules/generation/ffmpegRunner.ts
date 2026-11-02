import { spawn } from 'child_process';
import { ffmpegPath } from './binaries';
import { JobCancelledError, PermanentError, RetryableError } from './errors';

export interface RunFfmpegOptions {
  timeoutMs: number;
  totalDurationSeconds?: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  binaryPath?: string;
}

export type RunFfmpegFn = (args: string[], options: RunFfmpegOptions) => Promise<void>;

const STDERR_TAIL_BYTES = 4000;

export function parseProgressLine(line: string, totalSeconds?: number): number | undefined {
  const match = /^out_time_(?:us|ms)=(\d+)$/.exec(line.trim());
  if (!match || !totalSeconds) return undefined;
  return Math.min(1, Number(match[1]) / 1e6 / totalSeconds);
}

export function classifyFfmpegFailure(stderr: string): PermanentError | RetryableError {
  const tail = stderr.trim().split('\n').slice(-3).join(' | ').slice(0, 500);
  if (/Invalid data found|could not find codec|does not contain any stream|moov atom not found|Error opening input/i.test(stderr)) {
    return new PermanentError('INVALID_MEDIA', `The input media could not be processed (${tail || 'unreadable file'})`);
  }
  if (/No space left|Cannot allocate memory|Resource temporarily unavailable/i.test(stderr)) {
    return new RetryableError('RESOURCE_EXHAUSTED', 'The server ran out of resources while processing');
  }
  return new PermanentError('FFMPEG_FAILED', `Video processing failed (${tail || 'unknown error'})`);
}

export const runFfmpeg: RunFfmpegFn = (args, options) =>
  new Promise<void>((resolve, reject) => {
    if (options.signal?.aborted) return reject(new JobCancelledError());

    const child = spawn(options.binaryPath ?? ffmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let buffered = '';
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve();
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new RetryableError('FFMPEG_TIMEOUT', `Processing exceeded ${Math.round(options.timeoutMs / 1000)}s`));
    }, options.timeoutMs);

    const onAbort = () => {
      child.kill('SIGKILL');
      finish(new JobCancelledError());
    };
    options.signal?.addEventListener('abort', onAbort);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffered += chunk;
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) {
        const fraction = parseProgressLine(line, options.totalDurationSeconds);
        if (fraction !== undefined) options.onProgress?.(fraction);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL_BYTES);
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      finish(
        err.code === 'ENOENT'
          ? new PermanentError('FFMPEG_MISSING', 'ffmpeg is not installed on the server')
          : new RetryableError('FFMPEG_SPAWN_FAILED', 'Could not start the video processor'),
      );
    });
    child.on('close', (code) => {
      if (code === 0) {
        options.onProgress?.(1);
        finish();
      } else {
        finish(classifyFfmpegFailure(stderr));
      }
    });
  });
