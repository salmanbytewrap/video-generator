import cors from 'cors';
import { RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { ResponseError } from '../utils/response';

export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        mediaSrc: ["'self'", 'blob:', 'https:'],
        connectSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
}

export function corsMiddleware(allowedOrigins: string): RequestHandler {
  const origins = allowedOrigins
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return cors({
    origin: (origin, callback) => callback(null, !origin || origins.includes(origin)),
    allowedHeaders: ['Content-Type', 'idToken', 'Idempotency-Key'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    maxAge: 600,
  });
}

export interface RateLimitOptions {
  windowMs: number;
  limit: number;
  message: string;
}

export function createRateLimit({ windowMs, limit, message }: RateLimitOptions): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
    handler: (_req, res) => {
      res.status(429).json(new ResponseError({ error: 'TooManyRequestsError', message }));
    },
  });
}

export interface RateLimiters {
  auth?: RequestHandler;
  upload?: RequestHandler;
  createJob?: RequestHandler;
}

export function createRateLimiters(enabled: boolean): RateLimiters {
  if (!enabled) return {};
  return {
    auth: createRateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 20,
      message: 'Too many sign-in attempts. Try again in a few minutes.',
    }),
    upload: createRateLimit({ windowMs: 60 * 60 * 1000, limit: 30, message: 'Upload limit reached. Try again later.' }),
    createJob: createRateLimit({ windowMs: 60 * 60 * 1000, limit: 60, message: 'Generation limit reached. Try again later.' }),
  };
}
