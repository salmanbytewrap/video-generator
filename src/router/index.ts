import { Router } from 'express';
import config from '../config';
import { AppDependencies, createServices } from '../container';
import { createAssetModule } from '../modules/asset';
import { createAuthModule } from '../modules/auth';
import { createJobModule } from '../modules/job';
import { createUserModule } from '../modules/user';
import { LocalStorage } from '../storage';
import { createFilesRouter } from '../storage/files.routes';

export function createRouter(deps: AppDependencies): Router {
  const { assetService, jobService } = createServices(deps);
  const router = Router();
  router.use('/auth', createAuthModule(deps.userRepository));
  router.use('/users', createUserModule(deps.userRepository));
  router.use('/assets', createAssetModule(assetService, { maxUploadBytes: config.UPLOAD_MAX_BYTES }));
  router.use('/jobs', createJobModule(jobService));
  if (deps.storage instanceof LocalStorage) {
    router.use('/files', createFilesRouter(deps.storage));
  }
  return router;
}
