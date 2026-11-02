export interface ResponseErrorOptions {
  error?: string;
  message?: string;
  details?: unknown;
}

export class ResponseError {
  success = false as const;
  error: string;
  message: string;
  details?: unknown;

  constructor(options: ResponseErrorOptions = {}) {
    this.error = options.error ?? 'An error occurred';
    this.message = options.message ?? 'An error occurred';
    if (options.details !== undefined) this.details = options.details;
  }
}

export interface ResponseSuccessOptions<T> {
  message?: string;
  data?: T;
}

export class ResponseSuccess<T = unknown> {
  success = true as const;
  message: string;
  data?: T;

  constructor(options: ResponseSuccessOptions<T> = {}) {
    this.message = options.message ?? 'Success';
    if (options.data !== undefined) this.data = options.data;
  }
}
