import { randomUUID } from 'crypto';
import { rm } from 'fs/promises';
import path from 'path';
import { StorageProvider } from '../../storage';
import { BadRequestError, NotFoundError, UnsupportedMediaTypeError } from '../../utils/AppError';
import { MediaMetadata, ProbeFn } from '../generation/ffprobe';
import { Asset, AssetRepository, AssetSource } from './asset.repository';
import { detectFileTypeFromPath } from './fileType';

export interface AssetLimits {
  maxVideoSeconds: number;
  ttlDays: number;
}

export interface IngestFileInput {
  userId: string;
  tempPath: string;
  originalName: string;
  size: number;
  source: AssetSource;
  sourceUrl?: string;
  title?: string;
}

export interface AssetView {
  id: string;
  kind: Asset['kind'];
  mimeType: string;
  originalName: string;
  size: number;
  source: AssetSource;
  sourceUrl?: string;
  title?: string;
  metadata: MediaMetadata;
  url: string;
  createdAt: Date;
}

const MIN_DIMENSION = 64;
const MAX_DIMENSION = 8192;

export function sanitizeFileName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\- ]/g, '_').trim();
  return (base || 'upload').slice(0, 200);
}

export class AssetService {
  constructor(
    private readonly assets: AssetRepository,
    private readonly storage: StorageProvider,
    private readonly probe: ProbeFn,
    private readonly limits: AssetLimits,
  ) {}

  async ingestFile(input: IngestFileInput): Promise<AssetView> {
    try {
      const type = await detectFileTypeFromPath(input.tempPath);
      if (!type) {
        throw new UnsupportedMediaTypeError('Only MP4, MOV, WebM, JPEG, PNG and WebP files are supported');
      }

      let metadata: MediaMetadata;
      try {
        metadata = await this.probe(input.tempPath);
      } catch {
        throw new BadRequestError('The file could not be read. It may be corrupt.');
      }
      this.validate(type.kind, metadata);

      const storageKey = `uploads/${input.userId}/${randomUUID()}.${type.extension}`;
      await this.storage.putFile(storageKey, input.tempPath, type.mimeType);

      const asset = await this.assets.create({
        userId: input.userId,
        kind: type.kind,
        role: 'input',
        mimeType: type.mimeType,
        originalName: sanitizeFileName(input.originalName),
        size: input.size,
        storageKey,
        source: input.source,
        sourceUrl: input.sourceUrl,
        title: input.title,
        metadata,
        expiresAt: new Date(Date.now() + this.limits.ttlDays * 24 * 60 * 60 * 1000),
      });
      return this.toView(asset);
    } finally {
      await rm(input.tempPath, { force: true });
    }
  }

  async getAsset(userId: string, id: string): Promise<AssetView> {
    return this.toView(await this.getOwnedAsset(userId, id));
  }

  async getOwnedAsset(userId: string, id: string): Promise<Asset> {
    const asset = await this.assets.findOneForUser(id, userId);
    if (!asset) throw new NotFoundError('Asset not found');
    return asset;
  }

  private validate(kind: Asset['kind'], metadata: MediaMetadata): void {
    const { width, height, durationSeconds } = metadata;
    if (width < MIN_DIMENSION || height < MIN_DIMENSION || width > MAX_DIMENSION || height > MAX_DIMENSION) {
      throw new BadRequestError(`Dimensions must be between ${MIN_DIMENSION}px and ${MAX_DIMENSION}px`);
    }
    if (kind === 'video') {
      if (!durationSeconds) throw new BadRequestError('Could not determine video duration');
      if (durationSeconds > this.limits.maxVideoSeconds) {
        throw new BadRequestError(`Videos must be ${this.limits.maxVideoSeconds} seconds or shorter`);
      }
    }
  }

  private async toView(asset: Asset): Promise<AssetView> {
    return {
      id: asset.id,
      kind: asset.kind,
      mimeType: asset.mimeType,
      originalName: asset.originalName,
      size: asset.size,
      source: asset.source,
      sourceUrl: asset.sourceUrl,
      title: asset.title,
      metadata: asset.metadata,
      url: await this.storage.getDownloadUrl(asset.storageKey, { contentType: asset.mimeType }),
      createdAt: asset.createdAt,
    };
  }
}
