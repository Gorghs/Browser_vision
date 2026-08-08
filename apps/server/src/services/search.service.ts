import type { SearchQuery, SearchResponse } from '@vab/types';
import type { Repositories } from '../repositories/types.js';
import type { VisualRepositories } from '../repositories/visual-types.js';

/**
 * Search across every collected surface.
 *
 * Each kind of hit is produced by the repository that owns that data, so the
 * service is a fan-out rather than a pile of bespoke queries: events match on
 * URLs, domains and titles; screenshots on page fields and OCR text; analyses
 * on summaries, intents, tasks and purposes; activities on titles and
 * descriptions.
 */
export class SearchService {
  constructor(
    private readonly repositories: Repositories,
    private readonly visual: VisualRepositories,
  ) {}

  async search(query: SearchQuery): Promise<SearchResponse> {
    const q = query.q;
    const limit = query.limit;

    const [events, screenshots, analyses, activities] = await Promise.all([
      this.repositories.events.list(null, { q, sessionId: query.sessionId, limit, offset: 0 }),
      this.visual.screenshots.list(null, { q, sessionId: query.sessionId, limit, offset: 0 }),
      this.visual.analyses.search(null, query.sessionId, q, limit),
      this.visual.timeline.search(null, query.sessionId, q, limit),
    ]);

    return {
      query: q,
      events: events.events,
      screenshots: screenshots.screenshots,
      activities,
      analyses,
    };
  }
}
