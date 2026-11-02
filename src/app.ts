import express, { Express } from 'express';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { MongoUserRepository, UserRepository } from './modules/user';
import { createRouter } from './router';
import { ResponseSuccess } from './utils/response';

export interface AppDependencies {
  userRepository?: UserRepository;
}

export function createApp(deps: AppDependencies = {}): Express {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json(new ResponseSuccess({ message: 'Server is running' }));
  });
  app.use('/api', createRouter(deps.userRepository ?? new MongoUserRepository()));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
