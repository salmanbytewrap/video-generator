import express, { Express } from 'express';
import { existsSync } from 'fs';
import path from 'path';
import config from './config';
import { AppDependencies, createDependencies } from './container';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { corsMiddleware, createRateLimiters, securityHeaders } from './middleware/security';
import { createRouter } from './router';
import { ResponseSuccess } from './utils/response';

const WEB_DIST = path.resolve(__dirname, '..', 'web', 'dist');

export function createApp(overrides: Partial<AppDependencies> | AppDependencies = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  if (config.NODE_ENV === 'production') app.set('trust proxy', 1);

  app.use(securityHeaders());
  app.use('/api', corsMiddleware(config.CORS_ORIGIN));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json(new ResponseSuccess({ message: 'Server is running' }));
  });
  app.use('/api', createRouter(createDependencies(overrides), createRateLimiters(config.NODE_ENV !== 'test')));
  app.use('/api', notFoundHandler);

  if (existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
