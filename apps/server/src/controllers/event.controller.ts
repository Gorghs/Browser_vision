import type { RequestHandler } from 'express';
import { ingestEventsRequestSchema, listEventsQuerySchema } from '@vab/types';
import type { IngestEventsResponse, ListEventsResponse } from '@vab/types';
import type { EventService } from '../services/event.service.js';

/**
 * HTTP concerns only: parse, delegate, respond.
 *
 * Validation failures throw; the error handler turns a ZodError into a 400 with
 * the offending paths, so no controller repeats that translation.
 */
export function createEventController(service: EventService) {
  const ingest: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const { installationId, events } = ingestEventsRequestSchema.parse(req.body);
        const result: IngestEventsResponse = await service.ingest(installationId, events);
        res.status(202).json(result);
      } catch (cause) {
        next(cause);
      }
    })();
  };

  const list: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const query = listEventsQuerySchema.parse(req.query);
        const page = await service.list(query);
        const body: ListEventsResponse = { events: page.events, total: page.total };
        res.json(body);
      } catch (cause) {
        next(cause);
      }
    })();
  };

  return { ingest, list };
}
