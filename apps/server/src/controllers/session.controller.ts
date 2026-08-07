import type { RequestHandler } from 'express';
import { listSessionsQuerySchema } from '@vab/types';
import type { ListSessionsResponse } from '@vab/types';
import type { SessionService } from '../services/session.service.js';

export function createSessionController(service: SessionService) {
  const list: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const { limit } = listSessionsQuerySchema.parse(req.query);
        const body: ListSessionsResponse = { sessions: await service.list(limit) };
        res.json(body);
      } catch (cause) {
        next(cause);
      }
    })();
  };

  return { list };
}
