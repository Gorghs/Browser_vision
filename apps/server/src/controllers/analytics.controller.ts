import type { RequestHandler } from 'express';
import type { AnalyticsSummaryResponse } from '@vab/types';
import type { AnalyticsService } from '../services/analytics.service.js';

export function createAnalyticsController(service: AnalyticsService) {
  const summary: RequestHandler = (_req, res, next) => {
    void (async () => {
      try {
        const body: AnalyticsSummaryResponse = { summary: await service.summary() };
        res.json(body);
      } catch (cause) {
        next(cause);
      }
    })();
  };

  return { summary };
}
