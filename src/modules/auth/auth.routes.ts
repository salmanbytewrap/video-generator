import { Router } from 'express';
import { decodeToken } from './auth.middleware';
import { AuthController } from './auth.controller';

export function createAuthRouter(controller: AuthController): Router {
  const router = Router();
  router.post('/register', controller.register);
  router.post('/login', controller.login);
  router.get('/me', decodeToken, controller.me);
  return router;
}
