import { PermanentError, RetryableError, toJobError } from '../../../src/modules/generation/errors';

describe('generation errors', () => {
  it('toJobError_WithGenerationError_KeepsCodeMessageAndRetryability', () => {
    expect(toJobError(new RetryableError('STORAGE_ERROR', 'blip'))).toEqual({
      code: 'STORAGE_ERROR',
      message: 'blip',
      retryable: true,
    });
    expect(toJobError(new PermanentError('INVALID_MEDIA', 'bad'))).toMatchObject({ retryable: false });
  });

  it('toJobError_WithUnknownError_HidesDetailsAndAllowsRetry', () => {
    expect(toJobError(new Error('secret stack detail'))).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Unexpected error while generating content',
      retryable: true,
    });
  });
});
