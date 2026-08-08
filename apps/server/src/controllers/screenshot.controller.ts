import type { RequestHandler } from 'express';
import { z } from 'zod';
import { listScreenshotsQuerySchema, uploadScreenshotRequestSchema } from '@vab/types';
import type { ListScreenshotsResponse } from '@vab/types';
import type { ScreenshotService } from '../services/screenshot.service.js';

const idParamSchema = z.object({ id: z.uuid() });

export function createScreenshotController(service: ScreenshotService) {
  const upload: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const request = uploadScreenshotRequestSchema.parse(req.body);
        res.status(202).json(await service.upload(request));
      } catch (cause) {
        next(cause);
      }
    })();
  };

  const list: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const query = listScreenshotsQuerySchema.parse(req.query);
        const page = await service.list(query);
        const body: ListScreenshotsResponse = page;
        res.json(body);
      } catch (cause) {
        next(cause);
      }
    })();
  };

  /**
   * Serves the image itself.
   *
   * Streamed through the API rather than handed out as a signed storage URL, so
   * the same route works for both storage backends and so access stays behind
   * the API key instead of a link that outlives it.
   */
  const image: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const { id } = idParamSchema.parse(req.params);
        const { bytes, contentType } = await service.readImage(id);

        res.setHeader('content-type', contentType);
        // Immutable: a screenshot's bytes never change once stored.
        res.setHeader('cache-control', 'private, max-age=3600, immutable');
        res.send(Buffer.from(bytes));
      } catch (cause) {
        next(cause);
      }
    })();
  };

  return { upload, list, image };
}
