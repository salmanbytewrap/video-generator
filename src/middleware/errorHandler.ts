import { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError';
import { ResponseError } from '../utils/response';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json(new ResponseError({ error: 'Not Found', message: 'Route not found' }));
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res
      .status(400)
      .json(new ResponseError({ error: 'Bad Request', message: 'Validation failed', details: err.issues }));
  }
  if (err instanceof MulterError) {
    const tooLarge = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooLarge ? 413 : 400).json(
      new ResponseError({
        error: tooLarge ? 'PayloadTooLargeError' : 'BadRequestError',
        message: tooLarge ? 'File is too large' : `Upload error: ${err.code}`,
      }),
    );
  }
  if (err instanceof AppError) {
    return res.status(err.statusCode).json(new ResponseError({ error: err.name, message: err.message }));
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json(new ResponseError({ error: 'Bad Request', message: 'Malformed JSON body' }));
  }
  console.error(err);
  return res
    .status(500)
    .json(new ResponseError({ error: 'Internal Server Error', message: 'Internal server error' }));
}
