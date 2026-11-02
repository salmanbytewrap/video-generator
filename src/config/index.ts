import 'dotenv/config';
import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    MONGODB_URI: z.string().min(1).default('mongodb://localhost:27017/video-generator'),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    PUBLIC_BASE_URL: z.string().url().optional(),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_EXPIRES_IN: z.string().regex(/^\d+[smhd]$/).default('1h'),
    JWT_ISSUER: z.string().min(1).default('video-generator'),
    BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    LOCAL_STORAGE_DIR: z.string().default('./storage'),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default('auto'),
    S3_ENDPOINT: z.string().url().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),

    UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(200 * 1024 * 1024),
    MAX_VIDEO_SECONDS: z.coerce.number().positive().default(180),

    FFMPEG_PATH: z.string().optional(),
    FFPROBE_PATH: z.string().optional(),
    FFMPEG_TIMEOUT_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),

    EMBEDDED_WORKER: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
    WORKER_POLL_MS: z.coerce.number().int().positive().default(1000),
    JOB_LOCK_MS: z.coerce.number().int().positive().default(60 * 1000),
    MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    MAX_ACTIVE_JOBS_PER_USER: z.coerce.number().int().min(1).default(3),
    OUTPUT_TTL_DAYS: z.coerce.number().positive().default(7),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER !== 's3') return;
    for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
      if (!env[key]) {
        ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when STORAGE_DRIVER=s3` });
      }
    }
  });

const config = envSchema.parse(process.env);

export type AppConfig = typeof config;

export default config;
