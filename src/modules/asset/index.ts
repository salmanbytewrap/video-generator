import { Router } from 'express';
import { AssetController } from './asset.controller';
import { AssetRouterOptions, createAssetRouter } from './asset.routes';
import { AssetService } from './asset.service';

export function createAssetModule(service: AssetService, options: AssetRouterOptions): Router {
  return createAssetRouter(new AssetController(service), options);
}

export { MongoAssetRepository } from './asset.repository';
export type { Asset, AssetRepository, CreateAssetData } from './asset.repository';
export { AssetService } from './asset.service';
export type { AssetView, IngestFileInput } from './asset.service';
