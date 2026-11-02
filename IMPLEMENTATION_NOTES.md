# Implementation notes

These notes cover what is real and what is simulated, how the system is put together, the trade-offs behind it, known issues, and how I would evolve the product.

## Real vs simulated

| Capability                         | Status        | Notes                                                                                                        |
| ---------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------ |
| Upload, validation and probing     | Real          | Type is detected from magic bytes; ffprobe checks dimensions, duration, rotation and audio                    |
| URL / product-page import          | Real          | SSRF-guarded fetch; uses OpenGraph/Twitter video or image tags                                               |
| Resizing to platform formats       | Real          | FFmpeg: crop-to-fill or blurred-background fit, trimming, frame-rate normalisation, H.264/AAC, `+faststart`   |
| Image-to-video                     | Real          | 6-second Ken Burns zoom (`zoompan`) with a silent audio track                                                |
| Thumbnail                          | Real          | Frame grab at about 1 s, JPEG                                                                                 |
| Job queue, retries, cancellation   | Real          | Two drivers: MongoDB polling (default) or BullMQ on Redis (`QUEUE_DRIVER=bullmq`). See below                 |
| Storage and signed links           | Real          | Local disk (HMAC-signed, supports range requests) or S3/R2 (presigned)                                        |
| **Captions and hashtags**          | **Simulated** | `SimulatedCaptionGenerator` picks per-platform templates and hashtags deterministically from the title or filename. Results are flagged `simulated: true` and the UI says so |
| Smart reframing, scene detection   | Not built     | Cropping is centred. See "Evolving the product"                                                              |

The caption provider sits behind the `CaptionGenerator` interface (`src/modules/generation/caption.generator.ts`), so a real LLM provider is a single new class plus a config switch. The pipeline doesn't change. Caption generation is already a separate pipeline stage with its own progress band, and a caption failure is retryable.

## Architecture

```
Browser (React SPA)
   │  idToken header, polling every 2 s while a job is active
   ▼
Express API ──────────► MongoDB  (users, assets, jobs — the source of truth for job state)
   │      │                ▲
   │      │ dispatch       │ claim / heartbeat / complete / fail
   │      ▼                │
   │   Redis + BullMQ ───► Worker(s): download input → ffmpeg → thumbnail → upload → caption
   │   (QUEUE_DRIVER=bullmq;          │
   │    with the default mongo        │
   │    driver workers poll MongoDB)  │
   ▼                                  ▼
StorageProvider (local disk with signed links | S3/R2 with presigned URLs)
```

The code is organised in feature modules (`auth`, `user`, `asset`, `job`, `generation`). Each module has a model, a repository, a service, a controller and routes. Services depend on repository, storage and dispatcher **interfaces**, and `container.ts` wires in the concrete Mongo, storage, probe and queue implementations. That is why the services can be unit-tested with mocks and the HTTP layer can be tested against an in-memory MongoDB.

The job module contains the queue machinery:

| File                 | Role                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `job.executor.ts`    | Runs one claimed job: heartbeat, progress, cancellation, shutdown release, error classification, backoff. Shared by both drivers |
| `job.worker.ts`      | Mongo driver: polls `claimNext`, runs the stale-lock sweeper                                           |
| `job.dispatcher.ts`  | `JobDispatcher` interface: no-op for Mongo, `BullJobDispatcher` adds a BullMQ message for Redis        |
| `bullmq.worker.ts`   | BullMQ driver: consumes messages, claims by ID, re-dispatches retries, runs the reconciler             |

### Job lifecycle

`queued → processing → completed | failed | cancelled`. A job can go back to `queued` for a retry, either on a backoff timer or when the user presses Retry.

- **Claim**: always one atomic `findOneAndUpdate` in MongoDB that sets `processing`, `lockedBy` and `lockedUntil`, and increments `attempts`. Two workers can never claim the same job.
  - *Mongo driver*: `claimNext` matches `{ status: 'queued', runAfter <= now }`, sorted by `runAfter` then `createdAt`.
  - *BullMQ driver*: the message carries only the job ID, and `claimById` matches `{ _id, status: 'queued' }`. A duplicate or late delivery, or a message for a job cancelled while queued, finds nothing to claim and is dropped.
- **Heartbeat**: while FFmpeg runs, the worker extends `lockedUntil` and reads `cancelRequested`. If the lock is lost (another worker re-queued the job) or a cancel is requested, the worker aborts FFmpeg via `AbortSignal`.
- **Completion and failure** write only when `lockedBy` still matches the worker, so a zombie worker can't overwrite a newer attempt.
- **Retries**: `RetryableError` (FFmpeg timeout, storage or network errors) re-queues the job with exponential backoff and jitter until `maxAttempts` is reached. With BullMQ, the retry is also dispatched as a delayed message whose ID is `{jobId}-a{attempt}`, so each attempt has exactly one pending message. `PermanentError` (corrupt input, unsupported codec, missing binary) fails immediately with a user-readable message.
- **Crash recovery**:
  - A sweeper re-queues `processing` jobs whose lock has expired, or fails them if they have no attempts left.
  - With BullMQ, a reconciler runs every `QUEUE_RECONCILE_MS` (15 s by default). It runs the same sweep and then re-dispatches every runnable queued job. That covers the dual-write problem (MongoDB insert succeeded, `queue.add` failed), a Redis flush, and jobs recovered by the sweeper.
  - On SIGTERM, workers release their in-flight jobs back to `queued` instead of leaving them locked.
- **Idempotency**: `POST /api/jobs` accepts an `Idempotency-Key`. A unique partial index on `{ userId, idempotencyKey }` makes double-submits return the original job, even when two requests race. The UI generates a new key whenever the form changes.
- **Output keys** include the attempt number (`outputs/{user}/{job}/attempt-N.mp4`), so a retried attempt never collides with a half-written earlier one.

Delivery is at-least-once in both drivers. The atomic claim and the lock-guarded writes make each attempt take effect exactly once.

### Security

- **Auth**: bcrypt-hashed passwords; HS384 JWTs with issuer and expiry checks, sent in the `idToken` header. Every asset and job query is scoped by `userId`, so other users' resources return 404, not 403.
- **Uploads**: size-limited by multer, written to a temp directory, then checked by magic bytes and ffprobe before anything is stored. Stored names are server-generated UUIDs; the original filename is sanitised and kept only for display and download.
- **FFmpeg**: started with `spawn` and an argument array (no shell). It has a hard timeout with SIGKILL, and there are caps on duration and dimensions.
- **URL import (SSRF)**:
  - Only http and https URLs on ports 80 and 443 are accepted, without embedded credentials.
  - DNS is resolved, and the request is rejected if *any* resolved address is private, loopback, link-local (including the 169.254.169.254 metadata endpoint), CGNAT, multicast or reserved. IPv4-mapped IPv6 addresses are checked too.
  - The socket is pinned to the vetted address with a custom `lookup`, which defeats DNS rebinding.
  - Redirects are followed manually (at most 3) and each hop is re-validated.
  - Downloads have an overall deadline and byte caps on both the HTML page and the media.
- **HTTP**: helmet with a strict CSP, a CORS allowlist, and a 100 kb JSON body limit. Rate limits apply to auth, upload and job creation. Error responses never include stack traces.
- **Files**: local download links are HMAC-signed over the key, expiry, filename and content type, and expire after 15 minutes by default. The content type comes from the stored asset, never from the request, and `nosniff` is set.
- **Secrets**: all configuration is validated at startup with zod. `JWT_SECRET`, `MONGODB_URI`, `REDIS_URL` and the S3 keys come only from the environment.
- **Retention**: an hourly job deletes uploaded and generated media after `OUTPUT_TTL_DAYS`.

## Trade-offs

- **Two queue drivers: MongoDB by default, BullMQ on Redis as an option.**
  - The MongoDB driver means one fewer service to run, the job record *is* the queue entry so status can't drift, and it is easy to inspect. Its costs are polling (about 1 s by default) and lower throughput.
  - `QUEUE_DRIVER=bullmq` delivers jobs immediately through Redis and scales to many workers. Its costs are one more piece of infrastructure, and keeping two stores consistent, which the reconciler handles.
  - In both drivers MongoDB stays the source of truth and BullMQ only signals which job ID to run. Job execution lives in a shared `JobExecutor`, so both drivers behave identically and the API and UI don't change.
- **Embedded worker by default in deployment.** A single container is the cheapest option. Rendering competes with the API for CPU, so `WORKER_CONCURRENCY=1` is set on small instances. The same image runs as a dedicated worker (`node dist/worker.js`) when you need to scale.
- **Polling, not WebSockets or SSE.** Polling every 2 s only while a job is active is simple, works behind every proxy, and needs no sticky sessions. SSE would be the next step if many jobs run concurrently.
- **Tokens in `localStorage`.** This is simple and works with the existing `idToken` header convention. The downside is exposure to XSS, which the strict CSP (`script-src 'self'`, no inline scripts) and React's escaping mitigate. An httpOnly, SameSite cookie with CSRF protection would be stronger.
- **Centre crop.** It is fast and predictable, but it can cut off subjects in landscape-to-vertical conversions. The blurred-background fit mode is the safe alternative and is one click away in the UI.
- **Hand-written OpenGraph parsing and file sniffing.** I wrote these rather than pull in `cheerio`/`file-type`. The surface is small (a handful of meta tags and six magic signatures), `file-type` is ESM-only, and fewer dependencies means a smaller attack surface. Pages that render their media with client-side JavaScript aren't supported.
- **FFmpeg instead of a hosted video API.** It is free, deterministic, runs anywhere, and keeps media in our own storage. The cost is CPU per render, which is why rendering runs in workers.
- **Vitest instead of Jest.** The MongoDB driver's handshake fails inside Jest's VM sandbox; Vitest runs it natively and is faster.

## Known issues

- **URL import** works only when the page exposes media in OpenGraph/Twitter tags. Pages that render media with JavaScript, sites that block bots, and links to YouTube or TikTok watch pages (which point to HTML players, not media files) are rejected with a clear message.
- **Uploads go through the API.** A 200 MB upload holds an API connection while it streams. Direct-to-S3 presigned uploads would remove that load.
- **Embedded worker** shares CPU with the API, so on a small instance the API can feel slower during a render. Run `node dist/worker.js` separately when this matters.
- **Free hosting tiers**: Render's free instances sleep and have ephemeral disks, so the first request can be slow and production must use `STORAGE_DRIVER=s3`.
- **Captions are English-only templates** and don't look at the video content.
- **No browser E2E tests.** The UI has been exercised manually and through the API-level end-to-end runs, not with Playwright.
- **With BullMQ, when Redis is down** new jobs stay `queued` in MongoDB until Redis is back and the reconciler re-dispatches them. Nothing is lost, but nothing runs either; the Mongo driver has no such dependency.
- **Polling** adds a small amount of load per active job and up to 2 s of status latency.

## Testing

There are 260 tests. The pure logic is unit-tested: presets, FFmpeg argument building, progress parsing, error classification, captions, file sniffing, OpenGraph parsing, the IP blocklist and the backoff calculation. Integration tests run against an in-memory MongoDB and cover:
- the queue operations: claim races (`claimNext` and `claimById`), heartbeat, stale-lock sweep, idempotency races,
- the Mongo worker loop, with fake processors for success, retry, permanent failure, cancellation and shutdown,
- the BullMQ driver against a real Redis, which the tests start themselves (CI uses a Redis service container): dispatch dedupe, delayed retries, the reconciler picking up jobs that were never enqueued, and messages for cancelled jobs being skipped,
- the full HTTP API, including signed file links and range requests.

At least one test renders a real video with FFmpeg and checks the output dimensions with ffprobe. Coverage is about 96% of statements, and CI enforces an 80% threshold.

## Evolving the product

I would prioritise by user value per unit of effort. Each step builds on interfaces that already exist.

1. **Real AI captions** (highest value, low effort): an OpenAI or Anthropic `CaptionGenerator` that uses the page title, product description and a few sampled frames, with a timeout, a cost cap, and fallback to the simulated provider.
2. **One upload, every format**: let the user tick several platforms and formats at once and create a batch of jobs. This is mostly UI and service work, because jobs are already independent.
3. **Smarter editing**: face and saliency detection (for example MediaPipe) to steer the crop window, scene-cut detection for highlight reels, and burned-in subtitles from speech-to-text.
4. **Brand kits**: saved logo, colours, fonts and outro cards applied to every output.
5. **Publish and schedule**: connect Instagram, TikTok and YouTube accounts with OAuth and post directly or on a schedule.
6. **Feedback loop**: pull engagement metrics back in, to learn which formats and captions perform best.
7. **Teams and billing**: workspaces, roles, usage quotas and paid plans.

Engineering work to support that growth:

- **Scale**: run the BullMQ driver with dedicated, autoscaled worker pools keyed on queue depth, add a Bull Board dashboard, and use hardware or GPU encoding.
- **Uploads**: direct-to-S3 multipart uploads with presigned URLs, plus a CDN for outputs.
- **Real-time status**: Server-Sent Events instead of polling.
- **Observability**: structured logs with job and request IDs; metrics for queue depth, age of the oldest job, render time and failure rate by error code; alerting.
- **Security**: httpOnly cookie sessions, an OpenAPI contract, and Playwright E2E tests in CI.
