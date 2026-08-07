import { Router } from 'express';
import type { Repositories } from '../repositories/types.js';

/**
 * Liveness and configuration check.
 *
 * Unauthenticated on purpose: it must be reachable by a process checking
 * whether the server is up, and it reveals no activity data. It does report the
 * storage backend, so "why did my events vanish on restart?" has an answer that
 * does not require reading the logs.
 */
export function createHealthRouter(repositories: Repositories): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      storage: repositories.kind,
      ...(repositories.kind === 'memory'
        ? { warning: 'Using in-memory storage. Data is lost when the server restarts.' }
        : {}),
    });
  });

  return router;
}
