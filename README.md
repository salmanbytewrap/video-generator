# Clipforge — AI social media content generator

Upload a video or image (or paste a product link), pick **Instagram**, **TikTok** or **YouTube** and a format, and get a correctly sized, platform-ready MP4 plus a caption and hashtags. Jobs run in a durable background queue; the UI shows live status and progress, a preview, and a download link.

- **API**: Node.js 22, TypeScript, Express 5, MongoDB/Mongoose, zod
- **Rendering**: FFmpeg / ffprobe (crop or blurred-background fit, trim, silent audio track, Ken Burns for stills, thumbnail)
- **Queue**: two drivers behind one interface, selected with `QUEUE_DRIVER`. `mongo` (the default) polls MongoDB; `bullmq` delivers jobs through Redis with BullMQ. Both have atomic claims, heartbeats, retries with backoff, stale-lock recovery and cancellation
- **Storage**: local disk with HMAC-signed links, or S3 / Cloudflare R2 with presigned URLs
- **Web**: React 19 + Vite + React Query, served by the same Express process in production
- **AI**: captions come from a deterministic **simulated** provider behind a `CaptionGenerator` interface (no API keys needed). See [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md).

## Supported outputs

| Platform  | Format    | Size      | Aspect | Max length |
| --------- | --------- | --------- | ------ | ---------- |
| Instagram | Reel      | 1080×1920 | 9:16   | 90 s       |
| Instagram | Square    | 1080×1080 | 1:1    | 60 s       |
| Instagram | Portrait  | 1080×1350 | 4:5    | 60 s       |
| TikTok    | Vertical  | 1080×1920 | 9:16   | 180 s      |
| YouTube   | Short     | 1080×1920 | 9:16   | 60 s       |
| YouTube   | Landscape | 1920×1080 | 16:9   | 180 s      |

All outputs are H.264/AAC MP4 at 30 fps with `+faststart`. Images become a 6-second clip with a slow zoom.

Inputs: MP4, MOV, WebM, JPEG, PNG and WebP up to 200 MB and 180 s, checked by magic bytes and ffprobe (not by file extension). URLs can point at a media file directly or at a web page whose OpenGraph/Twitter tags reference a video or image.

## Quick start

Prerequisites: Node.js 22+ and a MongoDB instance (local `mongod`, Docker, or Atlas). FFmpeg is bundled through `ffmpeg-static` and `@ffprobe-installer/ffprobe`, so nothing else is required.

```bash
cp .env.example .env            # set JWT_SECRET (≥ 32 chars) and MONGODB_URI
npm install
npm --prefix web install

# terminal 1: API on :3000, with the worker embedded
EMBEDDED_WORKER=true npm run dev

# terminal 2: React dev server on :5173 (proxies /api to :3000)
npm run web:dev
```

Open http://localhost:5173, create an account, upload a clip and generate.

To use Redis and BullMQ instead of MongoDB polling, start Redis (`brew services start redis`) and run `QUEUE_DRIVER=bullmq REDIS_URL=redis://localhost:6379 EMBEDDED_WORKER=true npm run dev`.

To run the worker as a separate process instead, leave `EMBEDDED_WORKER=false` and run `npm run dev:worker` in a third terminal. You can run as many workers as you like; claims are atomic.

### Production build

```bash
npm run build:all               # compiles the API to dist/ and the SPA to web/dist/
NODE_ENV=production EMBEDDED_WORKER=true npm start
```

Express serves `web/dist` with an SPA fallback, so one process provides the UI, the API and (optionally) the worker.

### Docker

```bash
docker build -t clipforge .
docker run -p 3000:3000 --env-file .env -e EMBEDDED_WORKER=true -v clipforge-data:/data clipforge
```

The image installs Debian's `ffmpeg`, runs as the `node` user under `tini`, and has a `/health` healthcheck. Use `node dist/worker.js` as the command to run a worker-only container.

## Deployment

The repo includes a Render blueprint ([render.yaml](render.yaml)) and a CI workflow ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

1. Create a MongoDB Atlas cluster and copy its connection string.
2. Create a Cloudflare R2 (or S3) bucket and an access key with read/write on it.
3. In Render, choose **New → Blueprint**, select this repository, and fill in `MONGODB_URI`, `PUBLIC_BASE_URL`, `CORS_ORIGIN` (the public URL) and the `S3_*` values. `JWT_SECRET` is generated for you.
4. Deploy. Render builds the Dockerfile and checks `/health`.

Container disks on Render and Railway are ephemeral, so use `STORAGE_DRIVER=s3` in production. Railway works the same way: deploy the Dockerfile and set the same variables.

## Configuration

Every variable is validated at startup by zod (`src/config/index.ts`); the app refuses to boot with an invalid configuration. See [.env.example](.env.example) for the full list. The main settings:

| Variable                   | Default                 | Purpose                                                      |
| -------------------------- | ----------------------- | ------------------------------------------------------------ |
| `MONGODB_URI`              | `mongodb://localhost…`  | Database                                                     |
| `JWT_SECRET`               | (required)              | Signs auth tokens and local file links                       |
| `STORAGE_DRIVER`           | `local`                 | `local` or `s3`                                              |
| `EMBEDDED_WORKER`          | `false`                 | Run the worker inside the API process                        |
| `QUEUE_DRIVER`             | `mongo`                 | `mongo` (poll MongoDB) or `bullmq` (Redis)                   |
| `REDIS_URL`                | (none)                  | Required when `QUEUE_DRIVER=bullmq`, e.g. `redis://localhost:6379` |
| `WORKER_CONCURRENCY`       | `2`                     | Parallel FFmpeg jobs per worker                              |
| `MAX_ATTEMPTS`             | `3`                     | Attempts before a job is marked failed                       |
| `MAX_ACTIVE_JOBS_PER_USER` | `3`                     | Queued + processing jobs allowed per user                    |
| `OUTPUT_TTL_DAYS`          | `7`                     | Uploaded and generated media are deleted after this          |
| `CORS_ORIGIN`              | `http://localhost:5173` | Comma-separated allowed browser origins                      |

## API

All responses use `{ success, message, data }`, and errors use `{ success: false, error, message, details? }`. Authenticated routes take the JWT in the `idToken` header.

| Method | Path                      | Description                                                  |
| ------ | ------------------------- | ------------------------------------------------------------ |
| POST   | `/api/auth/register`      | Create an account and return `{ user, token }`                 |
| POST   | `/api/auth/login`         | Sign in and return `{ user, token }`                         |
| GET    | `/api/auth/me`            | Current user                                                 |
| POST   | `/api/assets`             | Multipart upload (`file` field); returns the probed asset     |
| POST   | `/api/assets/url`         | `{ url }`: import media from a link or product page          |
| GET    | `/api/assets/:id`         | One of your assets                                           |
| GET    | `/api/jobs/presets`       | Platforms and formats (public)                               |
| POST   | `/api/jobs`               | `{ inputAssetId, platform, format, options }`; honours `Idempotency-Key` |
| GET    | `/api/jobs?page&limit`    | Your job history                                             |
| GET    | `/api/jobs/:id`           | Status, progress, stage, caption, preview and download URLs  |
| POST   | `/api/jobs/:id/cancel`    | Cancel a queued or running job                               |
| POST   | `/api/jobs/:id/retry`     | Re-queue a failed or cancelled job                           |
| GET    | `/api/jobs/:id/download`  | Fresh signed download URL                                    |
| GET    | `/api/jobs/:id/preview`   | Fresh signed inline URL                                      |
| GET    | `/health`                 | Liveness check                                               |

`options` is `{ fit: 'crop' | 'blur', trimStartSeconds, generateCaption }`, and every field is optional.

## Testing

```bash
npm test                 # all tests
npm run test:coverage    # with coverage (80% thresholds enforced)
npm run typecheck
```

There are 260 tests across 25 files, using Vitest with an in-memory MongoDB (pinned to 8.2.1). The BullMQ integration tests start a throwaway `redis-server` (or use `REDIS_TEST_URL`) and are skipped if Redis isn't installed. They cover:
- the preset table and FFmpeg argument builder,
- a real FFmpeg render of a generated sample,
- the job queue's state transitions, locking and retry logic,
- the worker loop for both queue drivers, including BullMQ on a real Redis (dispatch dedupe, delayed retries, reconciler, cancelled jobs),
- the asset and job HTTP APIs,
- signed links and range requests,
- the SSRF guards,
- security middleware.

Current coverage is about 97% of statements and 90% of branches.

## Project layout

```
src/
  app.ts, server.ts, worker.ts, workerRuntime.ts, container.ts
  config/            env validation, database connection
  middleware/        security (helmet, CORS, rate limits), error handler
  repository/        generic BaseRepository + interfaces
  storage/           StorageProvider, local + S3 drivers, signed /api/files route
  modules/
    auth/            JWT token, idToken middleware, register/login
    user/            user model, repository, service, routes
    asset/           uploads, magic-byte detection, URL import (safeFetch, OpenGraph), cleanup
    job/             job model, repository (queue operations), service, routes, worker loop
    generation/      presets, ffmpeg command builder and runner, ffprobe, captions, pipeline
web/                 React + Vite single-page app
tests/               Vitest unit and integration tests, mirroring src/
```
