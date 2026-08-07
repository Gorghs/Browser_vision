import { Router } from 'express';
import type { RequestHandler } from 'express';
import { createEventController } from '../controllers/event.controller.js';
import { createSessionController } from '../controllers/session.controller.js';
import type { Repositories } from '../repositories/types.js';
import { EventService } from '../services/event.service.js';
import { SessionService } from '../services/session.service.js';

export interface RouterOptions {
  repositories: Repositories;
  /** Applied to every route below; health lives outside the router. */
  auth: RequestHandler;
}

/**
 * API routes.
 *
 * Only endpoints with a real consumer exist: ingest for the extension, and the
 * two list endpoints the dashboard renders.
 */
export function createApiRouter({ repositories, auth }: RouterOptions): Router {
  const router = Router();
  const events = createEventController(new EventService(repositories));
  const sessions = createSessionController(new SessionService(repositories));

  router.use(auth);

  router.post('/events', events.ingest);
  router.get('/events', events.list);
  router.get('/sessions', sessions.list);

  return router;
}
