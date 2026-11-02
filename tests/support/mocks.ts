import type { Mocked } from 'vitest';
import type { Asset, AssetRepository } from '../../src/modules/asset';
import type { Job, JobRepository } from '../../src/modules/job';
import type { StorageProvider } from '../../src/storage';

export function createMockAssetRepository(): Mocked<AssetRepository> {
  return {
    find: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findOneForUser: vi.fn(),
    findExpired: vi.fn(),
  };
}

export function createMockJobRepository(): Mocked<JobRepository> {
  return {
    find: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findOneForUser: vi.fn(),
    findByIdempotencyKey: vi.fn(),
    listForUser: vi.fn(),
    countActiveForUser: vi.fn(),
    claimNext: vi.fn(),
    heartbeat: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    markCancelled: vi.fn(),
    release: vi.fn(),
    requeueStale: vi.fn(),
    requestCancel: vi.fn(),
    resetForRetry: vi.fn(),
  };
}

export function createMockStorage(): Mocked<StorageProvider> {
  return {
    putFile: vi.fn().mockResolvedValue(undefined),
    downloadToFile: vi.fn().mockResolvedValue(undefined),
    getDownloadUrl: vi.fn(async (key: string) => `https://files.test/${key}`),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

export const USER_ID = '507f1f77bcf86cd799439011';
export const OTHER_USER_ID = '507f1f77bcf86cd799439022';

export function buildAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: '64b000000000000000000001',
    userId: USER_ID,
    kind: 'video',
    role: 'input',
    mimeType: 'video/mp4',
    originalName: 'Cool Sneakers.mp4',
    size: 1000,
    storageKey: `uploads/${USER_ID}/a.mp4`,
    source: 'upload',
    metadata: { width: 1280, height: 720, durationSeconds: 10, hasAudio: true, videoCodec: 'h264', audioCodec: 'aac' },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function buildJob(overrides: Partial<Job> = {}): Job {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: '64c000000000000000000001',
    userId: USER_ID,
    inputAssetId: '64b000000000000000000001',
    platform: 'tiktok',
    format: 'vertical',
    options: { fit: 'crop', trimStartSeconds: 0, generateCaption: true },
    status: 'queued',
    progress: 0,
    stage: 'queued',
    attempts: 0,
    maxAttempts: 3,
    runAfter: now,
    cancelRequested: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
