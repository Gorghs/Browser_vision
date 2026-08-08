import type { RequestHandler } from 'express';
import { listTimelineQuerySchema } from '@vab/types';
import type { ListTimelineResponse } from '@vab/types';
import type { TimelineService } from '../services/timeline.service.js';

export function createTimelineController(service: TimelineService) {
  const list: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const query = listTimelineQuerySchema.parse(req.query);
        const body: ListTimelineResponse = { activities: await service.list(query) };
        res.json(body);
      } catch (cause) {
        next(cause);
      }
    })();
  };

  return { list };
}
