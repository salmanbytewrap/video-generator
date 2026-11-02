export abstract class GenerationError extends Error {
  abstract readonly retryable: boolean;

  constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Transient failure (storage/network blip, timeout under load). Safe to retry. */
export class RetryableError extends GenerationError {
  readonly retryable = true;
}

/** Deterministic failure (bad input, unsupported media). Retrying will not help. */
export class PermanentError extends GenerationError {
  readonly retryable = false;
}

export class JobCancelledError extends Error {
  constructor() {
    super('Job was cancelled');
    this.name = 'JobCancelledError';
  }
}

export function toJobError(err: unknown): { code: string; message: string; retryable: boolean } {
  if (err instanceof GenerationError) {
    return { code: err.code, message: err.message, retryable: err.retryable };
  }
  return { code: 'INTERNAL_ERROR', message: 'Unexpected error while generating content', retryable: true };
}
