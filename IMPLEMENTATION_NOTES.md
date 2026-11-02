# Implementation notes

These notes cover what is real and what is simulated, how the system is put together, the trade-offs behind it, and what I would do next.

## Real vs simulated

| Capability                         | Status        | Notes                                                                                                        |
| ---------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------ |
| Upload, validation and probing     | Real          | Type is detected from magic bytes; ffprobe checks dimensions, duration, rotation and audio                    |
| URL / product-page import          | Real          | SSRF-guarded fetch; uses OpenGraph/Twitter video or image tags                                               |
| Resizing to platform formats       | Real          | FFmpeg: crop-to-fill or blurred-background fit, trimming, frame-rate normalisation, H.264/AAC, `+faststart`   |
| Image-to-video                     | Real          | 6-second Ken Burns zoom (`zoompan`) with a silent audio track                                                |
| Thumbnail                          | Real          | Frame grab at about 1 s, JPEG                                                                                 |
| Job queue, retries, cancellation   | Real          | MongoDB-backed; see below                                                                                    |
| Storage and signed links           | Real          | Local disk (HMAC-signed, supports range requests) or S3/R2 (presigned)                                        |
| **Captions and hashtags**          | **Simulated** | `SimulatedCaptionGenerator` picks per-platform templates and hashtags deterministically from the title or filename. Results are flagged `simulated: true` and the UI says so |
| Smart reframing, scene detection   | Not built     | Cropping is centred. See next steps                                                                          |

The caption provider sits behind the `CaptionGenerator` interface (`src/modules/generation/caption.generator.ts`), so a real LLM provider is a single new class plus a config switch. The pipeline doesn't change. Caption generation is already a separate pipeline stage with its own progress band, and a caption failure is retryable.

## Architecture

```
Browser (React SPA)
   │  idToken header, polling every 2 s while a job is active
   ▼
Express API ──► MongoDB (users, assets, jobs = the queue)
   │                ▲
   │                │ atomic claim / heartbeat / complete
   ▼                │
StorageProvider ◄── Worker(s): download input → ffmpeg → thumbnail → upload → caption
(local disk | S3/R2)
```

The code is organised in feature modules (`auth`, `user`, `asset`, `job`, `generation`). Each module has a model, a repository, a service, a controller and routes. Services depend on repository and storage **interfaces**, and `container.ts` wires in the concrete Mongo, storage and probe implementations. That is why the services can be unit-tested with mocks and the HTTP layer can be tested against an in-memory MongoDB.

### Job lifecycle

`queued → processing → completed | failed | cancelled`. A job can go back to `queued` for a retry, either on a backoff timer or when the user presses Retry.

- **Claim**: a single `findOneAndUpdate` on `{ status: 'queued', runAt <= now }`, sorted by `runAt` then `createdAt`. It sets `processing`, `lockedBy`, `lockedUntil` and increments `attempts`. Two workers can never claim the same job.
- **Heartbeat**: while FFmpeg runs, the worker extends `lockedUntil` and reads `cancelRequested`. If the lock is lost (another worker re-queued the job) or a cancel is requested, the worker aborts FFmpeg via `AbortSignal`.
- **Completion and failure** write only when `lockedBy` still matches the worker, so a zombie worker can't overwrite a newer attempt.
- **Retries**: `RetryableError` (FFmpeg timeout, storage or network errors) re-queues the job with exponential backoff and jitter until `maxAttempts` is reached. `PermanentError` (corrupt input, unsupported codec, missing binary) fails immediately with a user-readable message.
- **Crash recovery**: a sweeper re-queues `processing` jobs whose lock has expired, or fails them if they have no attempts left. On SIGTERM, workers release their in-flight jobs back to `queued` instead of leaving them locked.
- **Idempotency**: `POST /api/jobs` accepts an `Idempotency-Key`. A unique partial index on `{ userId, idempotencyKey }` makes double-submits return the original job, even when two requests race. The UI generates a new key whenever the form changes.
- **Output keys** include the attempt number (`outputs/{user}/{job}/attempt-N.mp4`), so a retried attempt never collides with a half-written earlier one.

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
- **Retention**: an hourly job deletes uploaded and generated media after `OUTPUT_TTL_DAYS`.

## Trade-offs

- **Two queue drivers: MongoDB by default, BullMQ on Redis as an option.** The MongoDB driver means one fewer service to run, the job record *is* the queue entry so status can't drift, and it is easy to inspect. Its costs are polling (about 1 s by default) and lower throughput. `QUEUE_DRIVER=bullmq` delivers jobs immediately through Redis. In both drivers, MongoDB stays the source of truth:
  - Each BullMQ message carries only the job ID and has the ID `{jobId}-a{attempt}`, so dispatching the same attempt twice is a no-op.
  - The worker claims the MongoDB job atomically before running it (`claimById`), so duplicate or late deliveries, or messages for cancelled jobs, do nothing.
  - Retries are re-dispatched as delayed messages.
  - A reconciler runs every `QUEUE_RECONCILE_MS`. It recovers stale locks and re-dispatches any runnable queued job, which covers a failed `queue.add` after the MongoDB insert (the dual-write problem) and a Redis flush.
  - Job execution (heartbeat, cancel, shutdown release, error classification) lives in a shared `JobExecutor`, so both drivers behave the same.
- **Embedded worker by default in deployment.** A single container is the cheapest option. Rendering competes with the API for CPU, so `WORKER_CONCURRENCY=1` is set on small instances. The same image runs as a dedicated worker (`node dist/worker.js`) when you need to scale.
- **Polling, not WebSockets or SSE.** Polling every 2 s only while a job is active is simple, works behind every proxy, and needs no sticky sessions. SSE would be the next step if many jobs run concurrently.
- **Tokens in `localStorage`.** This is simple and works with the existing `idToken` header convention. The downside is exposure to XSS, which the strict CSP (`script-src 'self'`, no inline scripts) and React's escaping mitigate. An httpOnly, SameSite cookie with CSRF protection would be stronger.
- **Centre crop.** It is fast and predictable, but it can cut off subjects in landscape-to-vertical conversions. The blurred-background fit mode is the safe alternative and is one click away in the UI.
- **Hand-written OpenGraph parsing and file sniffing.** I wrote these rather than pull in `cheerio`/`file-type`. The surface is small (a handful of meta tags and six magic signatures), `file-type` is ESM-only, and fewer dependencies means a smaller attack surface. Pages that render their media with client-side JavaScript aren't supported.
- **Vitest instead of Jest.** The MongoDB driver's handshake fails inside Jest's VM sandbox; Vitest runs it natively and is faster.

## Testing

There are 260 tests. The pure logic is unit-tested: presets, FFmpeg argument building, progress parsing, error classification, captions, file sniffing, OpenGraph parsing, the IP blocklist and the backoff calculation. Integration tests run against an in-memory MongoDB and cover:
- the queue operations: claim races, heartbeat, stale-lock sweep, idempotency races,
- the worker loop, with fake processors for success, retry, permanent failure, cancellation and shutdown,
- the full HTTP API, including signed file links and range requests.

At least one test renders a real video with FFmpeg and checks the output dimensions with ffprobe.

## Next steps

1. **Real AI captions**: an OpenAI or Anthropic `CaptionGenerator` that uses the page title and a few sampled frames, with a timeout, a cost cap, and fallback to the simulated provider.
2. **Smart reframing**: face and saliency detection (for example MediaPipe) to drive the crop window across a clip, plus scene-cut detection for highlights.
3. **More output**: burned-in subtitles from speech-to-text, a brand watermark or logo, and several formats from one upload in a single batch.
4. **Scale**: switch on the BullMQ driver, autoscale workers on queue depth, add a Bull Board dashboard, and add GPU or hardware encoding.
5. **Uploads**: direct-to-S3 multipart uploads with presigned URLs, so large files bypass the API.
6. **Observability**: structured logs with job and request IDs, metrics for queue depth, render time and failure rate, and alerting.
7. **Product**: social account OAuth for direct publishing, scheduled posts, teams, and usage quotas or billing.
