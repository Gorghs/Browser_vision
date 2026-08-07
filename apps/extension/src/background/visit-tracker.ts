/**
 * Tracks how long each tab spent on its current page.
 *
 * Chrome reports navigations, not durations. A visit ends when the tab
 * navigates away, is closed, or loses focus to another tab, so the duration has
 * to be assembled from those moments.
 *
 * State is kept in storage rather than memory because the service worker will
 * not survive between a page opening and the user leaving it.
 */

export interface OpenVisit {
  url: string;
  startedAt: string;
  /** Accumulated foreground time before the current activation, in ms. */
  accumulatedMs: number;
  /** When the tab last became active, or null while it is in the background. */
  activeSince: string | null;
}

export interface VisitStorage {
  read(): Promise<Record<string, OpenVisit>>;
  write(visits: Record<string, OpenVisit>): Promise<void>;
}

export interface CompletedVisit {
  url: string;
  startedAt: string;
  durationMs: number;
}

export class VisitTracker {
  constructor(
    private readonly storage: VisitStorage,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Records that a tab has moved to a new page.
   *
   * Returns the visit that just ended, if there was one, so the caller can
   * attach its duration to the navigation event.
   */
  async startVisit(tabId: number, url: string, isActive: boolean): Promise<CompletedVisit | null> {
    const visits = await this.storage.read();
    const previous = visits[String(tabId)];
    const completed = previous ? this.complete(previous) : null;

    const timestamp = this.now().toISOString();
    visits[String(tabId)] = {
      url,
      startedAt: timestamp,
      accumulatedMs: 0,
      activeSince: isActive ? timestamp : null,
    };
    await this.storage.write(visits);
    return completed;
  }

  /** Marks a tab as foregrounded, resuming its timer. */
  async activate(tabId: number): Promise<void> {
    const visits = await this.storage.read();
    const visit = visits[String(tabId)];
    if (!visit || visit.activeSince !== null) return;

    visit.activeSince = this.now().toISOString();
    await this.storage.write(visits);
  }

  /** Marks a tab as backgrounded, banking the time it spent in front. */
  async deactivate(tabId: number): Promise<void> {
    const visits = await this.storage.read();
    const visit = visits[String(tabId)];
    if (!visit || visit.activeSince === null) return;

    visit.accumulatedMs += this.elapsedSince(visit.activeSince);
    visit.activeSince = null;
    await this.storage.write(visits);
  }

  /** Ends and forgets a tab's visit, as when the tab is closed. */
  async endVisit(tabId: number): Promise<CompletedVisit | null> {
    const visits = await this.storage.read();
    const visit = visits[String(tabId)];
    if (!visit) return null;

    delete visits[String(tabId)];
    await this.storage.write(visits);
    return this.complete(visit);
  }

  private complete(visit: OpenVisit): CompletedVisit {
    const active = visit.activeSince === null ? 0 : this.elapsedSince(visit.activeSince);
    return {
      url: visit.url,
      startedAt: visit.startedAt,
      durationMs: visit.accumulatedMs + active,
    };
  }

  private elapsedSince(iso: string): number {
    return Math.max(0, this.now().getTime() - new Date(iso).getTime());
  }
}
