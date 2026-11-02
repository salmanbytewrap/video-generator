import { RequestHandler, Router } from 'express';
import multer from 'multer';
import { mkdirSync } from 'fs';
import os from 'os';
import path from 'path';
import { decodeToken } from '../auth/auth.middleware';
import { AssetController } from './asset.controller';

export interface AssetRouterOptions {
  maxUploadBytes: number;
  uploadRateLimit?: RequestHandler;
}

export function createAssetRouter(controller: AssetController, options: AssetRouterOptions): Router {
  const uploadDir = path.join(os.tmpdir(), 'video-generator-uploads');
  mkdirSync(uploadDir, { recursive: true });
  const upload = multer({
    dest: uploadDir,
    limits: { fileSize: options.maxUploadBytes, files: 1, fields: 5 },
  });

  const router = Router();
  router.use(decodeToken);
  const uploadMiddleware = [upload.single('file')];
  if (options.uploadRateLimit) uploadMiddleware.unshift(options.uploadRateLimit);
  router.post('/', ...uploadMiddleware, controller.upload);
  router.get('/:id', controller.getById);
  return router;
}
