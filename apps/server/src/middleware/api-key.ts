import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { UnauthorizedError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

/**
 * Compares two secrets without leaking their contents through timing.
 *
 * Lengths are compared first because `timingSafeEqual` throws on a mismatch;
 * that leaks the length, which is not worth defending here.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface ApiKeyOptions {
  apiKey: string | undefined;
  logger: Logger;
}

/**
 * Requires a shared API key.
 *
 * When no key is configured the middleware allows every request and says so,
 * loudly, once at startup. That combination is only reachable outside
 * production — `loadConfig` refuses to start a production server without a key.
 */
export function requireApiKey({ apiKey, logger }: ApiKeyOptions): RequestHandler {
  if (apiKey === undefined) {
    logger.warn(
      'API_KEY is not set: the API is unauthenticated. Acceptable for local development only.',
    );
    return (_req, _res, next) => next();
  }

  return (req, _res, next) => {
    const provided = req.get('x-api-key');
    if (provided === undefined || !secretsMatch(provided, apiKey)) {
      next(new UnauthorizedError());
      return;
    }
    next();
  };
}
