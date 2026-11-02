import { Router } from 'express';
import { AssetController } from './asset.controller';
import { AssetRouterOptions, createAssetRouter } from './asset.routes';
import { AssetService } from './asset.service';
import { UrlImportService } from './urlImport.service';

export function createAssetModule(
  service: AssetService,
  urlImport: UrlImportService,
  options: AssetRouterOptions,
): Router {
  return createAssetRouter(new AssetController(service, urlImport), options);
}

export { MongoAssetRepository } from './asset.repository';
export type { Asset, AssetRepository, CreateAssetData } from './asset.repository';
export { AssetService } from './asset.service';
export type { AssetView, IngestFileInput } from './asset.service';
export { UrlImportService } from './urlImport.service';
export type { UrlImportOptions } from './urlImport.service';
