import { RequestHandler, Router } from 'express';
import { decodeToken } from './auth.middleware';
import { AuthController } from './auth.controller';

export function createAuthRouter(controller: AuthController, rateLimit?: RequestHandler): Router {
  const router = Router();
  const limited = rateLimit ? [rateLimit] : [];
  router.post('/register', ...limited, controller.register);
  router.post('/login', ...limited, controller.login);
  router.get('/me', decodeToken, controller.me);
  return router;
}
