import { EVENT_LIMITS, extractDomain, isTrackableUrl, sanitizeUrl } from '@vab/types';
import type { BrowserEvent, BrowserEventType } from '@vab/types';
import { isDomainBlocked } from '../services/settings.js';
import type { ExtensionSettings } from '../services/settings.js';
import type { SessionManager } from './session-manager.js';

/**
 * What a listener knows about an event before it is normalized.
 *
 * Listeners never build a `BrowserEvent` themselves — identity, timestamps,
 * session assignment and every privacy rule are applied here, in one place, so
 * a new listener cannot accidentally bypass them.
 */
export interface EventDraft {
  type: BrowserEventType;
  url?: string | undefined;
  title?: string | undefined;
  tabId?: number | undefined;
  windowId?: number | undefined;
  metadata?: Record<string, unknown>;
}

export interface EventSink {
  enqueue(event: BrowserEvent): Promise<void>;
}

export interface EventCollectorOptions {
  sink: EventSink;
  sessions: SessionManager;
  getSettings: () => Promise<ExtensionSettings>;
  now?: () => Date;
  newId?: () => string;
}

/** Why an event was not recorded. Returned so callers can be tested precisely. */
export type CollectOutcome =
  | { recorded: true; event: BrowserEvent }
  | { recorded: false; reason: 'tracking-disabled' | 'untrackable-url' | 'blocked-domain' };

export class EventCollector {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(private readonly options: EventCollectorOptions) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  /**
   * Normalizes a draft and queues it, unless policy says not to.
   *
   * The order matters: tracking state is checked before anything touches the
   * URL, so a disabled extension never even inspects where the user is.
   */
  async record(draft: EventDraft): Promise<CollectOutcome> {
    const settings = await this.options.getSettings();
    if (!settings.trackingEnabled) return { recorded: false, reason: 'tracking-disabled' };

    let url: string | undefined;
    let domain: string | undefined;

    if (draft.url !== undefined) {
      if (!isTrackableUrl(draft.url)) return { recorded: false, reason: 'untrackable-url' };
      domain = extractDomain(draft.url);
      if (isDomainBlocked(domain, settings.blockedDomains)) {
        return { recorded: false, reason: 'blocked-domain' };
      }
      url = sanitizeUrl(draft.url, EVENT_LIMITS.urlMaxLength);
    }

    const { session, started, expired } = await this.options.sessions.ensure();

    if (expired) {
      // The previous session ended when the user stopped, not when we noticed.
      await this.emit({ type: 'SESSION_ENDED' }, expired.id, expired.lastActivityAt);
    }
    if (started) {
      await this.emit({ type: 'SESSION_STARTED' }, session.id, session.startedAt);
    }

    const event = await this.emit({ ...draft, url, title: draft.title }, session.id);
    return { recorded: true, event };
  }

  /** Starts a session explicitly, as when the user switches tracking on. */
  async startSession(): Promise<void> {
    const settings = await this.options.getSettings();
    if (!settings.trackingEnabled) return;

    const { session, started, expired } = await this.options.sessions.ensure();
    if (expired) {
      await this.emit({ type: 'SESSION_ENDED' }, expired.id, expired.lastActivityAt);
    }
    if (started) {
      await this.emit({ type: 'SESSION_STARTED' }, session.id, session.startedAt);
    }
  }

  /** Ends the current session, as when the user switches tracking off. */
  async endSession(): Promise<void> {
    const ended = await this.options.sessions.end();
    if (ended) await this.emit({ type: 'SESSION_ENDED' }, ended.id);
  }

  private async emit(
    draft: EventDraft & { url?: string | undefined },
    sessionId: string,
    timestamp?: string,
  ): Promise<BrowserEvent> {
    const domain = draft.url ? extractDomain(draft.url) : undefined;
    const event: BrowserEvent = {
      id: this.newId(),
      sessionId,
      type: draft.type,
      timestamp: timestamp ?? this.now().toISOString(),
      metadata: draft.metadata ?? {},
      ...(draft.url !== undefined ? { url: draft.url } : {}),
      ...(domain !== undefined ? { domain } : {}),
      ...(draft.title !== undefined
        ? { title: draft.title.slice(0, EVENT_LIMITS.titleMaxLength) }
        : {}),
      ...(draft.tabId !== undefined ? { tabId: draft.tabId } : {}),
      ...(draft.windowId !== undefined ? { windowId: draft.windowId } : {}),
    };

    await this.options.sink.enqueue(event);
    return event;
  }
}
