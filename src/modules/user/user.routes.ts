import { Router } from 'express';
import { decodeToken } from '../auth/auth.middleware';
import { UserController } from './user.controller';

export function createUserRouter(controller: UserController): Router {
  const router = Router();
  router.use(decodeToken);
  router.get('/', controller.list);
  router.get('/:id', controller.getById);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.remove);
  return router;
}
