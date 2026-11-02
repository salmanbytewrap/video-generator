import { Router } from 'express';
import { createAuthModule } from '../modules/auth';
import { createUserModule, UserRepository } from '../modules/user';

export function createRouter(userRepository: UserRepository): Router {
  const router = Router();
  router.use('/auth', createAuthModule(userRepository));
  router.use('/users', createUserModule(userRepository));
  return router;
}
