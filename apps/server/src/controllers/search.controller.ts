import type { RequestHandler } from 'express';
import { searchQuerySchema } from '@vab/types';
import type { SearchResponse } from '@vab/types';
import type { SearchService } from '../services/search.service.js';

export function createSearchController(service: SearchService) {
  const search: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const query = searchQuerySchema.parse(req.query);
        const body: SearchResponse = await service.search(query);
        res.json(body);
      } catch (cause) {
        next(cause);
      }
    })();
  };

  return { search };
}
