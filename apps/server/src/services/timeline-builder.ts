import { TIMELINE_RULES } from '@vab/types';
import type { BrowserEvent, TimelineActivity, VisionAnalysis } from '@vab/types';

/**
 * Turns raw events into readable activities.
 *
 * A pure function over events and analyses, with no storage or network, because
 * the segmentation rules are the part most worth being able to test exhaustively.
 *
 * When a vision analysis covers a stretch, its description is used. When none
 * does — no AI configured, visual capture off, analysis still pending — the
 * activity is assembled from the events themselves. The timeline is therefore a
 * feature of the telemetry layer that AI improves, not one that depends on it.
 */

export interface EventSegment {
  startedAt: string;
  endedAt: string;
  /** Domains seen, most frequent first. */
  domains: string[];
  events: BrowserEvent[];
}

export interface AnalysisAtTime {
  capturedAt: string;
  analysis: VisionAnalysis;
}

/**
 * Cuts a session's events into stretches.
 *
 * A stretch ends when the user moves to a different site, or stops for long
 * enough that picking up again is new work rather than a continuation.
 *
 * Events with no domain — session lifecycle, window focus — join the current
 * stretch without redirecting it. Treating a focus change as a site change
 * would split every activity in two the moment the user glanced at another
 * application.
 */
export function segmentEvents(
  events: BrowserEvent[],
  rules: { idleGapMs: number } = TIMELINE_RULES,
): EventSegment[] {
  const ordered = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const segments: EventSegment[] = [];
  let current: { events: BrowserEvent[]; domain: string | undefined } | null = null;

  const flush = (): void => {
    if (!current || current.events.length === 0) return;

    const first = current.events[0];
    const last = current.events[current.events.length - 1];
    if (!first || !last) return;

    segments.push({
      startedAt: first.timestamp,
      endedAt: last.timestamp,
      domains: rankDomains(current.events),
      events: current.events,
    });
  };

  for (const event of ordered) {
    if (!current) {
      current = { events: [event], domain: event.domain };
      continue;
    }

    const previous = current.events[current.events.length - 1];
    const gap = previous
      ? new Date(event.timestamp).getTime() - new Date(previous.timestamp).getTime()
      : 0;

    const movedSite =
      event.domain !== undefined && current.domain !== undefined && event.domain !== current.domain;

    if (gap > rules.idleGapMs || movedSite) {
      flush();
      current = { events: [event], domain: event.domain };
      continue;
    }

    current.events.push(event);
    // A stretch that began with a domainless event adopts the first real one.
    current.domain ??= event.domain;
  }

  flush();
  return segments;
}

function rankDomains(events: BrowserEvent[]): string[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.domain === undefined) continue;
    counts.set(event.domain, (counts.get(event.domain) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([domain]) => domain)
    .slice(0, 20);
}

/** Analyses whose capture falls inside a segment. */
function analysesWithin(segment: EventSegment, analyses: AnalysisAtTime[]): VisionAnalysis[] {
  const from = new Date(segment.startedAt).getTime();
  const to = new Date(segment.endedAt).getTime();
  return analyses
    .filter((entry) => {
      const at = new Date(entry.capturedAt).getTime();
      return at >= from && at <= to;
    })
    .map((entry) => entry.analysis);
}

/** How many distinct pages the user actually opened during a stretch. */
function pageCount(segment: EventSegment): number {
  const urls = new Set(
    segment.events
      .filter((event) => event.type === 'NAVIGATION' || event.type === 'PAGE_LOADED')
      .map((event) => event.url)
      .filter((url): url is string => url !== undefined),
  );
  return urls.size;
}

/**
 * Describes a stretch without a model.
 *
 * Aims for something a person would recognise — "github.com, 4 pages" — rather
 * than pretending to an understanding the events do not contain. Category stays
 * `other` because guessing one from a domain would be a fabrication dressed as
 * a classification.
 */
export function describeWithoutAi(
  segment: EventSegment,
): Pick<TimelineActivity, 'title' | 'description' | 'category' | 'source'> {
  const [primary, ...rest] = segment.domains;
  const pages = pageCount(segment);

  if (primary === undefined) {
    return {
      title: 'Browser activity',
      description: `${String(segment.events.length)} events with no page context.`,
      category: 'other',
      source: 'derived',
    };
  }

  const title =
    rest.length > 0
      ? `${primary} and ${String(rest.length)} other site${rest.length === 1 ? '' : 's'}`
      : primary;

  const parts = [`${String(segment.events.length)} events`];
  if (pages > 0) parts.push(`${String(pages)} page${pages === 1 ? '' : 's'}`);

  return {
    title,
    description: parts.join(', '),
    category: 'other',
    source: 'derived',
  };
}

/**
 * Describes a stretch using the vision analyses that fall inside it.
 *
 * The most common task among them becomes the title: a stretch usually contains
 * several captures of the same piece of work, and the modal answer is more
 * stable than whichever one happened to be first.
 */
export function describeWithAi(
  analyses: VisionAnalysis[],
): Pick<TimelineActivity, 'title' | 'description' | 'category' | 'source'> | null {
  if (analyses.length === 0) return null;

  const task = mostCommon(analyses.map((analysis) => analysis.activity.currentTask));
  const category = mostCommon(analyses.map((analysis) => analysis.activity.activityCategory));
  const summary = analyses.map((analysis) => analysis.activity.summary).find(Boolean);

  if (task === undefined || category === undefined) return null;

  return {
    title: task.slice(0, 200),
    description: summary?.slice(0, 600) ?? null,
    category,
    source: 'ai',
  };
}

function mostCommon<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  let best: T | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

export interface BuildTimelineOptions {
  sessionId: string;
  events: BrowserEvent[];
  analyses: AnalysisAtTime[];
  newId: () => string;
  rules?: { idleGapMs: number; minEventsPerActivity: number };
}

export function buildTimeline({
  sessionId,
  events,
  analyses,
  newId,
  rules = TIMELINE_RULES,
}: BuildTimelineOptions): TimelineActivity[] {
  return segmentEvents(events, rules)
    .filter((segment) => segment.events.length >= rules.minEventsPerActivity)
    .map((segment) => {
      const described =
        describeWithAi(analysesWithin(segment, analyses)) ?? describeWithoutAi(segment);

      return {
        id: newId(),
        sessionId,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
        domains: segment.domains,
        eventCount: segment.events.length,
        ...described,
      };
    });
}
