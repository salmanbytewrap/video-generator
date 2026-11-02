import express, { Express } from 'express';
import { AppDependencies, createDependencies } from './container';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { createRouter } from './router';
import { ResponseSuccess } from './utils/response';

export function createApp(overrides: Partial<AppDependencies> = {}): Express {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json(new ResponseSuccess({ message: 'Server is running' }));
  });
  app.use('/api', createRouter(createDependencies(overrides)));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
