import cors from 'cors';
import express from 'express';
import type { Express } from 'express';
import type { AppConfig } from './config/env.js';
import type { Logger } from './lib/logger.js';
import { requireApiKey } from './middleware/api-key.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requestLogger } from './middleware/request-logger.js';
import type { Repositories } from './repositories/types.js';
import { createHealthRouter } from './routes/health.js';
import { createApiRouter } from './routes/index.js';

export interface AppOptions {
  config: AppConfig;
  repositories: Repositories;
  logger: Logger;
}

/**
 * Builds the Express application.
 *
 * Separated from process startup so tests can drive a real app over HTTP
 * without binding a port or reading the environment.
 */
export function createApp({ config, repositories, logger }: AppOptions): Express {
  const app = express();

  // Express advertises itself by default; there is no reason to tell callers
  // what the server is built with.
  app.disable('x-powered-by');

  app.use(
    cors({
      // An extension's requests carry an unpredictable chrome-extension://
      // origin, so origins are only restricted for browser page callers. The
      // API key is what actually gates access.
      origin: (origin, callback) => {
        if (origin === undefined || origin.startsWith('chrome-extension://')) {
          callback(null, true);
          return;
        }
        callback(null, config.corsOrigins.includes(origin));
      },
      allowedHeaders: ['content-type', 'x-api-key'],
    }),
  );

  // A batch is bounded at 200 events, each with a capped URL and title, so the
  // largest legitimate body is well under this. Anything larger is a mistake or
  // an attack, and is rejected before it is parsed.
  app.use(express.json({ limit: '1mb' }));

  app.use(requestLogger(logger));

  app.use(createHealthRouter(repositories));
  app.use(
    '/api',
    createApiRouter({
      repositories,
      auth: requireApiKey({ apiKey: config.apiKey, logger }),
    }),
  );

  app.use(notFoundHandler());
  app.use(errorHandler(logger));

  return app;
}
