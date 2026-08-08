import type { ListTimelineQuery, TimelineActivity } from '@vab/types';
import type { Repositories } from '../repositories/types.js';
import type { VisualRepositories } from '../repositories/visual-types.js';
import { buildTimeline } from './timeline-builder.js';

/** Upper bound on events pulled into one rebuild, so a huge session cannot stall the worker. */
const MAX_EVENTS_PER_SESSION = 5000;

export class TimelineService {
  constructor(
    private readonly repositories: Repositories,
    private readonly visual: VisualRepositories,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  /**
   * Regenerates a session's timeline from scratch.
   *
   * Wholesale rather than incremental because an activity's boundaries move as
   * later events arrive: a gap that looked like an ending turns out to be a
   * pause in the middle of one piece of work.
   */
  async rebuild(userId: string, sessionId: string): Promise<TimelineActivity[]> {
    const [events, analyses] = await Promise.all([
      this.repositories.events.listForSession(sessionId, MAX_EVENTS_PER_SESSION),
      this.visual.analyses.listForSession(sessionId),
    ]);

    const activities = buildTimeline({
      sessionId,
      events,
      analyses,
      newId: this.newId,
    });

    await this.visual.timeline.replaceForSession(userId, sessionId, activities);
    return activities;
  }

  list(query: ListTimelineQuery): Promise<TimelineActivity[]> {
    // Unscoped for the same reason as the other reads; see ARCHITECTURE.md.
    return this.visual.timeline.list(null, query.sessionId, query.limit);
  }
}
