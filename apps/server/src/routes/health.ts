import { Router } from 'express';
import type { AppConfig } from '../config/env.js';
import type { Persistence } from '../repositories/index.js';

/**
 * Liveness and configuration check.
 *
 * Unauthenticated on purpose: it must be reachable by a process checking
 * whether the server is up, and it reveals no activity data. It reports which
 * optional capabilities are actually switched on, so "why is nothing being
 * analysed?" has an answer that does not require reading the logs.
 */
export function createHealthRouter(persistence: Persistence, config: AppConfig): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      storage: persistence.repositories.kind,
      imageStorage: persistence.store.kind,
      // The provider name only. The key is never echoed anywhere.
      ai: config.ai?.provider ?? 'disabled',
      ocr: config.ocrEnabled ? 'enabled' : 'disabled',
      ...(persistence.repositories.kind === 'memory'
        ? { warning: 'Using in-memory storage. Data is lost when the server restarts.' }
        : {}),
    });
  });

  return router;
}
