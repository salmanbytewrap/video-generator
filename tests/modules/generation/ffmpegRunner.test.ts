import { JobCancelledError, PermanentError, RetryableError } from '../../../src/modules/generation/errors';
import { classifyFfmpegFailure, parseProgressLine, runFfmpeg } from '../../../src/modules/generation/ffmpegRunner';

/** Runs a Node script in place of ffmpeg so the runner can be tested without media. */
function fakeFfmpeg(script: string, options: Partial<Parameters<typeof runFfmpeg>[1]> = {}) {
  return runFfmpeg(['-e', script], { timeoutMs: 5_000, binaryPath: process.execPath, ...options });
}

describe('ffmpegRunner', () => {
  it('parseProgressLine_WithOutTime_ReturnsFractionOfTotal', () => {
    expect(parseProgressLine('out_time_us=5000000', 10)).toBe(0.5);
    expect(parseProgressLine('out_time_ms=20000000', 10)).toBe(1);
  });

  it('parseProgressLine_WithOtherLinesOrNoTotal_ReturnsUndefined', () => {
    expect(parseProgressLine('frame=12', 10)).toBeUndefined();
    expect(parseProgressLine('out_time_us=5000000')).toBeUndefined();
  });

  it.each([
    ['Invalid data found when processing input', PermanentError, 'INVALID_MEDIA'],
    ['moov atom not found', PermanentError, 'INVALID_MEDIA'],
    ['No space left on device', RetryableError, 'RESOURCE_EXHAUSTED'],
    ['Some other encoder failure', PermanentError, 'FFMPEG_FAILED'],
  ])('classifyFfmpegFailure_%s', (stderr, type, code) => {
    const error = classifyFfmpegFailure(stderr);
    expect(error).toBeInstanceOf(type);
    expect(error.code).toBe(code);
  });

  it('runFfmpeg_WhenProcessSucceeds_ReportsProgressAndResolves', async () => {
    const onProgress = vi.fn();

    await fakeFfmpeg("console.log('out_time_us=1000000'); console.log('out_time_us=2000000');", {
      totalDurationSeconds: 4,
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledWith(0.25);
    expect(onProgress).toHaveBeenCalledWith(0.5);
    expect(onProgress).toHaveBeenLastCalledWith(1);
  });

  it('runFfmpeg_WhenProcessFails_RejectsWithClassifiedError', async () => {
    await expect(
      fakeFfmpeg("console.error('Invalid data found when processing input'); process.exit(1);"),
    ).rejects.toMatchObject({ code: 'INVALID_MEDIA', retryable: false });
  });

  it('runFfmpeg_WhenTimeoutElapses_KillsProcessAndRejectsRetryable', async () => {
    await expect(fakeFfmpeg('setTimeout(() => {}, 10000);', { timeoutMs: 200 })).rejects.toMatchObject({
      code: 'FFMPEG_TIMEOUT',
      retryable: true,
    });
  });

  it('runFfmpeg_WhenAborted_KillsProcessAndRejectsCancelled', async () => {
    const controller = new AbortController();
    const run = fakeFfmpeg('setTimeout(() => {}, 10000);', { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);

    await expect(run).rejects.toBeInstanceOf(JobCancelledError);
  });

  it('runFfmpeg_WithAlreadyAbortedSignal_RejectsImmediately', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(fakeFfmpeg('', { signal: controller.signal })).rejects.toBeInstanceOf(JobCancelledError);
  });

  it('runFfmpeg_WhenBinaryMissing_RejectsPermanent', async () => {
    await expect(
      runFfmpeg([], { timeoutMs: 1_000, binaryPath: '/definitely/not/ffmpeg' }),
    ).rejects.toMatchObject({ code: 'FFMPEG_MISSING', retryable: false });
  });
});
