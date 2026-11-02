import { RequestHandler, Router } from 'express';
import { UserRepository } from '../user';
import { AuthController } from './auth.controller';
import { createAuthRouter } from './auth.routes';
import { AuthService } from './auth.service';

export function createAuthModule(userRepository: UserRepository, rateLimit?: RequestHandler): Router {
  return createAuthRouter(new AuthController(new AuthService(userRepository)), rateLimit);
}

export { decodeToken } from './auth.middleware';
export { createToken, verifyToken } from './token';
