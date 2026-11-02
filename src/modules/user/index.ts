import { Router } from 'express';
import { UserController } from './user.controller';
import { UserRepository } from './user.repository';
import { createUserRouter } from './user.routes';
import { UserService } from './user.service';

export function createUserModule(userRepository: UserRepository): Router {
  return createUserRouter(new UserController(new UserService(userRepository)));
}

export { MongoUserRepository } from './user.repository';
export type { User, UserCredentials, UserRepository } from './user.repository';
