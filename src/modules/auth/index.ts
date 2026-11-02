import { Router } from 'express';
import { UserRepository } from '../user';
import { AuthController } from './auth.controller';
import { createAuthRouter } from './auth.routes';
import { AuthService } from './auth.service';

export function createAuthModule(userRepository: UserRepository): Router {
  return createAuthRouter(new AuthController(new AuthService(userRepository)));
}

export { decodeToken } from './auth.middleware';
export { createToken, verifyToken } from './token';
