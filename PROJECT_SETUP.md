# Project setup: keys, secrets and directory tree

## Do I need any API keys?

**No AI or third-party API keys are needed.** Captions come from the built-in simulated provider, and FFmpeg is bundled through npm packages.

To run the project locally you need only **two** values in `.env`:

| Variable      | Required | What it is                                       | How to get it                                                                 |
| ------------- | -------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| `JWT_SECRET`  | Yes      | Signs login tokens and download links (≥ 32 chars) | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`    |
| `MONGODB_URI` | Yes      | MongoDB connection string                        | Local: `mongodb://localhost:27017/video-generator`; cloud: MongoDB Atlas      |

Everything else has a safe default (see `.env.example`).

### Extra secrets for production (optional locally)

Render and Railway disks are wiped on redeploy, so production stores media in S3 or Cloudflare R2:

| Variable               | Purpose                                     | Where to get it                                           |
| ---------------------- | ------------------------------------------- | --------------------------------------------------------- |
| `STORAGE_DRIVER=s3`    | Switch from local disk to S3/R2             | n/a                                                       |
| `S3_BUCKET`            | Bucket name                                 | Create a bucket in Cloudflare R2 or AWS S3                |
| `S3_ENDPOINT`          | R2 endpoint (omit for AWS)                  | `https://<account-id>.r2.cloudflarestorage.com`           |
| `S3_REGION`            | `auto` for R2, e.g. `us-east-1` for AWS     | n/a                                                       |
| `S3_ACCESS_KEY_ID`     | Access key                                  | R2: *Manage R2 API Tokens*; AWS: IAM user access key      |
| `S3_SECRET_ACCESS_KEY` | Secret key                                  | Same place as above                                       |
| `PUBLIC_BASE_URL`      | Public URL of the deployed app              | Your Render/Railway URL                                   |
| `CORS_ORIGIN`          | Allowed browser origin(s)                   | Same as `PUBLIC_BASE_URL`                                 |

Never commit `.env`; it is already in `.gitignore`.

### Minimal local `.env`

```env
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://localhost:27017/video-generator
JWT_SECRET=<paste-the-generated-96-char-hex-string>
EMBEDDED_WORKER=true
```

Then:

```bash
npm install && npm --prefix web install
npm run dev          # API + worker on :3000
npm run web:dev      # UI on :5173
```

## Directory tree

```
video-generator/
├── .github/workflows/ci.yml     # CI: typecheck, tests + coverage, build, Docker build
├── Dockerfile                   # Production image with system ffmpeg
├── render.yaml                  # Render blueprint (Atlas + R2)
├── .env.example                 # All configuration variables
├── README.md                    # Overview, API, deployment
├── IMPLEMENTATION_NOTES.md      # Real vs simulated, architecture, trade-offs
├── PROJECT_SETUP.md             # This file
├── package.json / tsconfig*.json / vitest.config.mts
│
├── src/
│   ├── app.ts                   # Express app: security, /api routes, SPA hosting
│   ├── server.ts                # HTTP entry point (optionally embeds the worker)
│   ├── worker.ts                # Standalone worker entry point
│   ├── workerRuntime.ts         # Worker + hourly media cleanup wiring
│   ├── container.ts             # Dependency wiring (repositories, storage, services)
│   ├── config/
│   │   ├── index.ts             # zod-validated environment config
│   │   └── database.ts          # connectDatabase / disconnectDatabase
│   ├── middleware/
│   │   ├── errorHandler.ts      # Maps errors to JSON responses
│   │   └── security.ts          # helmet CSP, CORS allowlist, rate limits
│   ├── repository/
│   │   ├── baseRepository.ts    # Generic Mongoose repository
│   │   └── interfaces.ts        # IRepository contract
│   ├── router/index.ts          # Mounts all module routers under /api
│   ├── storage/
│   │   ├── storage.types.ts     # StorageProvider interface
│   │   ├── local.storage.ts     # Disk storage with HMAC-signed links
│   │   ├── s3.storage.ts        # S3 / R2 storage with presigned URLs
│   │   ├── files.routes.ts      # Serves signed local files (range support)
│   │   └── index.ts             # createStorage()
│   ├── types/index.ts           # TokenPayload, Express.Request.user
│   ├── utils/
│   │   ├── AppError.ts          # HTTP error classes
│   │   ├── authUtils.ts         # bcrypt helpers
│   │   └── response.ts          # ResponseSuccess / ResponseError
│   └── modules/
│       ├── auth/                # token.ts, auth.middleware.ts (idToken), service, controller, routes
│       ├── user/                # model, repository, service, controller, routes
│       ├── asset/
│       │   ├── asset.*.ts       # model, repository, service, controller, routes, cleanup
│       │   ├── fileType.ts      # Magic-byte detection
│       │   ├── safeFetch.ts     # SSRF-safe HTTP fetch
│       │   ├── openGraph.ts     # Extracts og:video / og:image from pages
│       │   └── urlImport.service.ts
│       ├── job/
│       │   ├── job.*.ts         # model, repository (queue ops), service, controller, routes
│       │   └── job.worker.ts    # Claim, heartbeat, retry/backoff, stale sweep
│       └── generation/
│           ├── platformPresets.ts   # Instagram / TikTok / YouTube formats
│           ├── ffmpegCommand.ts     # Builds ffmpeg arguments
│           ├── ffmpegRunner.ts      # Runs ffmpeg with progress, timeout, abort
│           ├── ffprobe.ts / binaries.ts / errors.ts
│           ├── caption.generator.ts # Simulated AI captions
│           └── pipeline.ts          # download → transcode → thumbnail → upload → caption
│
├── tests/                       # Vitest; mirrors src/
│   ├── support/                 # in-memory Mongo, mocks, sample media
│   ├── middleware/  storage/
│   └── modules/{auth,user,asset,job,generation}/
│
└── web/                         # React + Vite frontend
    ├── index.html  vite.config.ts  tsconfig.json  package.json
    ├── public/favicon.svg
    └── src/
        ├── main.tsx  App.tsx  auth.tsx  api.ts  types.ts  format.ts  styles.css
        ├── components/{MediaPreview,StatusBadge}.tsx
        └── pages/{AuthPage,CreatePage,JobPage,HistoryPage}.tsx
```
