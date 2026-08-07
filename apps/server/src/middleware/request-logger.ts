import type { RequestHandler } from 'express';
import type { Logger } from '../lib/logger.js';

/**
 * Logs one line per completed request.
 *
 * Logs the route path and never the query string: this API's query strings
 * carry the domains and session identifiers being searched for, which is
 * exactly the activity data the project promises to handle carefully.
 */
export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logger.info('request', {
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      });
    });

    next();
  };
}
