import { describe, expect, it } from 'vitest';
import type { BrowserEvent, VisionAnalysis } from '@vab/types';
import { buildTimeline, describeWithoutAi, segmentEvents } from './timeline-builder.js';

const SESSION = '11111111-1111-4111-8111-111111111111';
const START = Date.UTC(2026, 7, 7, 10, 0, 0);

let counter = 0;
function event(offsetMs: number, overrides: Partial<BrowserEvent> = {}): BrowserEvent {
  counter += 1;
  return {
    id: `33333333-3333-4333-8333-${String(counter).padStart(12, '0')}`,
    sessionId: SESSION,
    type: 'PAGE_LOADED',
    timestamp: new Date(START + offsetMs).toISOString(),
    metadata: {},
    ...overrides,
  };
}

const RULES = { idleGapMs: 5 * 60_000, minEventsPerActivity: 2 };

function analysis(
  task: string,
  category: VisionAnalysis['activity']['activityCategory'],
): VisionAnalysis {
  return {
    page: { pageType: 'page', category, purpose: 'a purpose', importantElements: [] },
    activity: {
      userIntent: 'an intent',
      currentTask: task,
      activityCategory: category,
      summary: `Working on ${task}`,
    },
  };
}

describe('segmenting', () => {
  it('keeps continuous activity on one site together', () => {
    const segments = segmentEvents(
      [
        event(0, { domain: 'github.com' }),
        event(30_000, { domain: 'github.com' }),
        event(60_000, { domain: 'github.com' }),
      ],
      RULES,
    );

    expect(segments).toHaveLength(1);
    expect(segments[0]?.events).toHaveLength(3);
  });

  it('splits when the user moves to a different site', () => {
    const segments = segmentEvents(
      [
        event(0, { domain: 'github.com' }),
        event(10_000, { domain: 'github.com' }),
        event(20_000, { domain: 'react.dev' }),
      ],
      RULES,
    );

    expect(segments).toHaveLength(2);
  });

  it('splits after a long pause even on the same site', () => {
    const segments = segmentEvents(
      [
        event(0, { domain: 'github.com' }),
        event(10_000, { domain: 'github.com' }),
        event(10_000 + 6 * 60_000, { domain: 'github.com' }),
      ],
      RULES,
    );

    expect(segments).toHaveLength(2);
  });

  it('does not split on a pause shorter than the gap', () => {
    const segments = segmentEvents(
      [event(0, { domain: 'github.com' }), event(4 * 60_000, { domain: 'github.com' })],
      RULES,
    );

    expect(segments).toHaveLength(1);
  });

  it('does not let a domainless event split an activity', () => {
    // A window focus change mid-activity must not read as a site change.
    const segments = segmentEvents(
      [
        event(0, { domain: 'github.com' }),
        event(10_000, { type: 'WINDOW_FOCUS_CHANGED' }),
        event(20_000, { domain: 'github.com' }),
      ],
      RULES,
    );

    expect(segments).toHaveLength(1);
  });

  it('adopts the first real domain when a stretch begins with a domainless event', () => {
    const segments = segmentEvents(
      [event(0, { type: 'SESSION_STARTED' }), event(1_000, { domain: 'github.com' })],
      RULES,
    );

    expect(segments[0]?.domains).toEqual(['github.com']);
  });

  it('sorts events that arrive out of order', () => {
    const segments = segmentEvents(
      [event(60_000, { domain: 'a.example' }), event(0, { domain: 'a.example' })],
      RULES,
    );

    expect(segments[0]?.startedAt).toBe(new Date(START).toISOString());
  });

  it('ranks domains by how often they appear', () => {
    const segments = segmentEvents(
      [
        event(0, { domain: 'github.com' }),
        event(1_000, { type: 'CLICK', domain: 'github.com' }),
        event(2_000, { type: 'SCROLL', domain: 'github.com' }),
      ],
      RULES,
    );

    expect(segments[0]?.domains[0]).toBe('github.com');
  });

  it('returns nothing for an empty session', () => {
    expect(segmentEvents([], RULES)).toEqual([]);
  });
});

describe('descriptions without AI', () => {
  it('names the site and counts what happened', () => {
    const [segment] = segmentEvents(
      [
        event(0, { domain: 'github.com', url: 'https://github.com/a' }),
        event(1_000, { domain: 'github.com', url: 'https://github.com/b' }),
      ],
      RULES,
    );

    const described = describeWithoutAi(segment!);

    expect(described.title).toBe('github.com');
    expect(described.description).toContain('2 pages');
    expect(described.source).toBe('derived');
  });

  it('does not guess a category from the domain', () => {
    const [segment] = segmentEvents(
      [event(0, { domain: 'github.com' }), event(1_000, { domain: 'github.com' })],
      RULES,
    );

    // Inferring "development" from the hostname would be a fabrication
    // presented as a classification.
    expect(describeWithoutAi(segment!).category).toBe('other');
  });

  it('handles a stretch with no page context at all', () => {
    const [segment] = segmentEvents(
      [event(0, { type: 'SESSION_STARTED' }), event(1_000, { type: 'WINDOW_FOCUS_CHANGED' })],
      RULES,
    );

    expect(describeWithoutAi(segment!).title).toBe('Browser activity');
  });
});

describe('buildTimeline', () => {
  const newId = (() => {
    let n = 0;
    return () => {
      n += 1;
      return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    };
  })();

  it('drops stretches too small to be an activity', () => {
    const activities = buildTimeline({
      sessionId: SESSION,
      events: [event(0, { domain: 'github.com' })],
      analyses: [],
      newId,
      rules: RULES,
    });

    expect(activities).toEqual([]);
  });

  it('builds a timeline with no AI at all', () => {
    const activities = buildTimeline({
      sessionId: SESSION,
      events: [
        event(0, { domain: 'github.com', url: 'https://github.com/a' }),
        event(1_000, { domain: 'github.com', url: 'https://github.com/b' }),
      ],
      analyses: [],
      newId,
      rules: RULES,
    });

    expect(activities).toHaveLength(1);
    expect(activities[0]?.source).toBe('derived');
  });

  it('prefers a model description when one covers the stretch', () => {
    const activities = buildTimeline({
      sessionId: SESSION,
      events: [event(0, { domain: 'github.com' }), event(30_000, { domain: 'github.com' })],
      analyses: [
        {
          capturedAt: new Date(START + 10_000).toISOString(),
          analysis: analysis('Investigating a caching bug', 'development'),
        },
      ],
      newId,
      rules: RULES,
    });

    expect(activities[0]).toMatchObject({
      title: 'Investigating a caching bug',
      category: 'development',
      source: 'ai',
    });
  });

  it('takes the most common task when a stretch has several captures', () => {
    const activities = buildTimeline({
      sessionId: SESSION,
      events: [event(0, { domain: 'github.com' }), event(60_000, { domain: 'github.com' })],
      analyses: [
        {
          capturedAt: new Date(START + 5_000).toISOString(),
          analysis: analysis('Reading docs', 'documentation'),
        },
        {
          capturedAt: new Date(START + 20_000).toISOString(),
          analysis: analysis('Fixing a bug', 'development'),
        },
        {
          capturedAt: new Date(START + 40_000).toISOString(),
          analysis: analysis('Fixing a bug', 'development'),
        },
      ],
      newId,
      rules: RULES,
    });

    expect(activities[0]?.title).toBe('Fixing a bug');
  });

  it('ignores an analysis captured outside the stretch', () => {
    const activities = buildTimeline({
      sessionId: SESSION,
      events: [event(0, { domain: 'github.com' }), event(10_000, { domain: 'github.com' })],
      analyses: [
        {
          capturedAt: new Date(START + 60 * 60_000).toISOString(),
          analysis: analysis('Something else entirely', 'shopping'),
        },
      ],
      newId,
      rules: RULES,
    });

    expect(activities[0]?.source).toBe('derived');
  });

  it('describes some stretches with AI and others without', () => {
    const activities = buildTimeline({
      sessionId: SESSION,
      events: [
        event(0, { domain: 'github.com' }),
        event(10_000, { domain: 'github.com' }),
        event(20_000, { domain: 'react.dev' }),
        event(30_000, { domain: 'react.dev' }),
      ],
      analyses: [
        {
          capturedAt: new Date(START + 5_000).toISOString(),
          analysis: analysis('Investigating a bug', 'development'),
        },
      ],
      newId,
      rules: RULES,
    });

    expect(activities.map((activity) => activity.source)).toEqual(['ai', 'derived']);
  });

  it('records the span each activity covers', () => {
    const activities = buildTimeline({
      sessionId: SESSION,
      events: [event(0, { domain: 'github.com' }), event(45_000, { domain: 'github.com' })],
      analyses: [],
      newId,
      rules: RULES,
    });

    expect(activities[0]?.startedAt).toBe(new Date(START).toISOString());
    expect(activities[0]?.endedAt).toBe(new Date(START + 45_000).toISOString());
  });
});
