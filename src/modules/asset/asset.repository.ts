import { isValidObjectId } from 'mongoose';
import { BaseRepository, LeanDocument } from '../../repository/baseRepository';
import IRepository from '../../repository/interfaces';
import { MediaMetadata } from '../generation/ffprobe';
import { AssetModel, AssetSchema } from './asset.model';
import { AssetKind } from './fileType';

export type AssetRole = 'input' | 'output' | 'thumbnail';
export type AssetSource = 'upload' | 'url' | 'generated';

export interface Asset {
  id: string;
  userId: string;
  kind: AssetKind;
  role: AssetRole;
  mimeType: string;
  originalName: string;
  size: number;
  storageKey: string;
  source: AssetSource;
  sourceUrl?: string;
  title?: string;
  metadata: MediaMetadata;
  expiresAt?: Date;
  createdAt: Date;
}

export type CreateAssetData = Omit<Asset, 'id' | 'createdAt'>;

export interface AssetRepository extends IRepository<Asset, CreateAssetData> {
  findOneForUser(id: string, userId: string): Promise<Asset | null>;
  findExpired(now: Date, limit: number): Promise<Asset[]>;
}

export class MongoAssetRepository
  extends BaseRepository<AssetSchema, Asset, CreateAssetData>
  implements AssetRepository
{
  constructor() {
    super(AssetModel);
  }

  protected toEntity(doc: LeanDocument<AssetSchema>): Asset {
    const m = doc.metadata!;
    return {
      id: String(doc._id),
      userId: String(doc.userId),
      kind: doc.kind,
      role: doc.role,
      mimeType: doc.mimeType,
      originalName: doc.originalName,
      size: doc.size,
      storageKey: doc.storageKey,
      source: doc.source,
      sourceUrl: doc.sourceUrl ?? undefined,
      title: doc.title ?? undefined,
      metadata: {
        width: m.width,
        height: m.height,
        durationSeconds: m.durationSeconds ?? undefined,
        videoCodec: m.videoCodec ?? undefined,
        audioCodec: m.audioCodec ?? undefined,
        hasAudio: Boolean(m.hasAudio),
        frameRate: m.frameRate ?? undefined,
      },
      expiresAt: doc.expiresAt ?? undefined,
      createdAt: doc.createdAt,
    };
  }

  findOneForUser(id: string, userId: string): Promise<Asset | null> {
    if (!isValidObjectId(id) || !isValidObjectId(userId)) return Promise.resolve(null);
    return this.findOneBy({ _id: id, userId });
  }

  async findExpired(now: Date, limit: number): Promise<Asset[]> {
    const docs = await this._model
      .find({ expiresAt: { $lte: now } })
      .limit(limit)
      .lean<LeanDocument<AssetSchema>[]>();
    return docs.map((doc) => this.toEntity(doc));
  }
}
