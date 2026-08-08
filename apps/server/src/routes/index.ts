import { Router } from 'express';
import type { RequestHandler } from 'express';
import express from 'express';
import { createAnalyticsController } from '../controllers/analytics.controller.js';
import { createEventController } from '../controllers/event.controller.js';
import { createScreenshotController } from '../controllers/screenshot.controller.js';
import { createSessionController } from '../controllers/session.controller.js';
import { createTimelineController } from '../controllers/timeline.controller.js';
import type { Repositories } from '../repositories/types.js';
import type { VisualRepositories } from '../repositories/visual-types.js';
import { AnalyticsService } from '../services/analytics.service.js';
import { EventService } from '../services/event.service.js';
import { ScreenshotService } from '../services/screenshot.service.js';
import { SessionService } from '../services/session.service.js';
import { TimelineService } from '../services/timeline.service.js';
import type { ObjectStore } from '../storage/object-store.js';

export interface RouterOptions {
  repositories: Repositories;
  visual: VisualRepositories;
  store: ObjectStore;
  /** Applied to every route below; health lives outside the router. */
  auth: RequestHandler;
}

/**
 * A screenshot body is base64 image data, so it needs far more headroom than
 * the 1 MB the rest of the API allows. Applied to this one route rather than
 * raised globally, which would let any endpoint accept an 8 MB payload.
 */
const SCREENSHOT_BODY_LIMIT = '12mb';

/**
 * API routes.
 *
 * Only endpoints with a real consumer exist: ingest and upload for the
 * extension, and the list endpoints the dashboard renders.
 */
export function createApiRouter({ repositories, visual, store, auth }: RouterOptions): Router {
  const router = Router();

  const events = createEventController(new EventService(repositories));
  const sessions = createSessionController(new SessionService(repositories));
  const screenshots = createScreenshotController(
    new ScreenshotService(repositories, visual, store),
  );
  const timeline = createTimelineController(new TimelineService(repositories, visual));
  const analytics = createAnalyticsController(new AnalyticsService(repositories, visual));

  router.use(auth);

  router.post('/events', events.ingest);
  router.get('/events', events.list);
  router.get('/sessions', sessions.list);

  router.post('/screenshots', express.json({ limit: SCREENSHOT_BODY_LIMIT }), screenshots.upload);
  router.get('/screenshots', screenshots.list);
  router.get('/screenshots/:id/image', screenshots.image);

  router.get('/timeline', timeline.list);
  router.get('/analytics/summary', analytics.summary);

  return router;
}
