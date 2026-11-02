import { Router } from 'express';
import config from '../config';
import { AppDependencies, createServices } from '../container';
import { RateLimiters } from '../middleware/security';
import { createAssetModule } from '../modules/asset';
import { createAuthModule } from '../modules/auth';
import { createJobModule } from '../modules/job';
import { createUserModule } from '../modules/user';
import { LocalStorage } from '../storage';
import { createFilesRouter } from '../storage/files.routes';

export function createRouter(deps: AppDependencies, limiters: RateLimiters = {}): Router {
  const { assetService, urlImportService, jobService } = createServices(deps);
  const router = Router();
  router.use('/auth', createAuthModule(deps.userRepository, limiters.auth));
  router.use('/users', createUserModule(deps.userRepository));
  router.use(
    '/assets',
    createAssetModule(assetService, urlImportService, { maxUploadBytes: config.UPLOAD_MAX_BYTES, uploadRateLimit: limiters.upload }),
  );
  router.use('/jobs', createJobModule(jobService, { createRateLimit: limiters.createJob }));
  if (deps.storage instanceof LocalStorage) {
    router.use('/files', createFilesRouter(deps.storage));
  }
  return router;
}
