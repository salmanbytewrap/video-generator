import { RequestHandler, Router } from 'express';
import { decodeToken } from '../auth/auth.middleware';
import { JobController } from './job.controller';

export interface JobRouterOptions {
  createRateLimit?: RequestHandler;
}

export function createJobRouter(controller: JobController, options: JobRouterOptions = {}): Router {
  const router = Router();
  router.get('/presets', controller.presets);

  router.use(decodeToken);
  router.post('/', ...(options.createRateLimit ? [options.createRateLimit] : []), controller.create);
  router.get('/', controller.list);
  router.get('/:id', controller.getById);
  router.post('/:id/retry', controller.retry);
  router.post('/:id/cancel', controller.cancel);
  router.get('/:id/download', controller.download);
  router.get('/:id/preview', controller.preview);
  return router;
}
