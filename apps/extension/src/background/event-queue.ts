import { EVENT_LIMITS } from '@vab/types';
import type { BrowserEvent } from '@vab/types';
import { PermanentDeliveryError, RetryableDeliveryError } from './backend-client.js';

/**
 * Buffers events and delivers them in batches.
 *
 * The hard constraint is that a Manifest V3 service worker is killed whenever
 * Chrome feels like it, usually after ~30 seconds idle. Anything held only in
 * memory is lost, so the buffer is mirrored to storage after every change and
 * restored on the next wake-up.
 */

export interface QueueStorage {
  read(): Promise<BrowserEvent[]>;
  write(events: BrowserEvent[]): Promise<void>;
}

export interface QueueScheduler {
  /** Runs `task` after `delayMs`, replacing any previously scheduled retry. */
  schedule(delayMs: number, task: () => void): void;
  cancel(): void;
}

export interface QueueTelemetry {
  onDelivered(count: number, at: Date): void;
  onError(message: string): void;
  /** Events discarded because the buffer was full or the batch was rejected. */
  onDropped(count: number, reason: string): void;
}

export interface EventQueueOptions {
  send(events: BrowserEvent[]): Promise<{ accepted: number; duplicates: number }>;
  storage: QueueStorage;
  scheduler: QueueScheduler;
  telemetry: QueueTelemetry;
  /** Flush as soon as this many events are buffered. */
  flushAtSize?: number;
  /**
   * Ceiling on buffered events. Reached only when the backend has been
   * unreachable for a long time; past it the oldest events are dropped so a
   * long outage cannot grow extension storage without bound.
   */
  maxBufferedEvents?: number;
  retry?: { baseDelayMs?: number; maxDelayMs?: number };
}

const DEFAULTS = {
  flushAtSize: 25,
  maxBufferedEvents: 2000,
  baseDelayMs: 2_000,
  maxDelayMs: 5 * 60_000,
};

export class EventQueue {
  private buffer: BrowserEvent[] = [];
  private flushing = false;
  /** Set when a flush is requested while one is already running. */
  private flushAgain = false;
  private consecutiveFailures = 0;
  private restored = false;

  private readonly flushAtSize: number;
  private readonly maxBufferedEvents: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(private readonly options: EventQueueOptions) {
    this.flushAtSize = options.flushAtSize ?? DEFAULTS.flushAtSize;
    this.maxBufferedEvents = options.maxBufferedEvents ?? DEFAULTS.maxBufferedEvents;
    this.baseDelayMs = options.retry?.baseDelayMs ?? DEFAULTS.baseDelayMs;
    this.maxDelayMs = options.retry?.maxDelayMs ?? DEFAULTS.maxDelayMs;
  }

  get size(): number {
    return this.buffer.length;
  }

  /**
   * Loads anything left over from a previous service worker lifetime.
   *
   * Safe to call repeatedly; only the first call reads storage.
   */
  async restore(): Promise<void> {
    if (this.restored) return;
    this.restored = true;
    const persisted = await this.options.storage.read();
    if (persisted.length > 0) {
      this.buffer = [...persisted, ...this.buffer];
      this.trimToCapacity();
    }
  }

  async enqueue(event: BrowserEvent): Promise<void> {
    await this.restore();
    this.buffer.push(event);
    this.trimToCapacity();
    await this.persist();

    if (this.buffer.length >= this.flushAtSize) {
      await this.flush();
    }
  }

  /**
   * Attempts to deliver buffered events.
   *
   * Overlapping calls collapse: a flush requested while one is in flight sets a
   * flag and runs once the current attempt finishes, so a burst of events
   * cannot open several concurrent requests carrying the same batch.
   */
  async flush(): Promise<void> {
    await this.restore();
    if (this.flushing) {
      this.flushAgain = true;
      return;
    }
    if (this.buffer.length === 0) {
      this.options.scheduler.cancel();
      return;
    }

    this.flushing = true;
    try {
      do {
        this.flushAgain = false;
        await this.deliverOneBatch();
      } while (this.flushAgain && this.buffer.length > 0 && this.consecutiveFailures === 0);
    } finally {
      this.flushing = false;
    }
  }

  private async deliverOneBatch(): Promise<void> {
    const batch = this.buffer.slice(0, EVENT_LIMITS.batchMaxSize);
    if (batch.length === 0) return;

    try {
      const result = await this.options.send(batch);
      this.removeDelivered(batch);
      this.consecutiveFailures = 0;
      this.options.scheduler.cancel();
      await this.persist();
      this.options.telemetry.onDelivered(result.accepted + result.duplicates, new Date());
    } catch (cause) {
      if (cause instanceof PermanentDeliveryError) {
        // The backend will never accept this batch. Dropping it is the only way
        // to stop it blocking every event queued behind it.
        this.removeDelivered(batch);
        await this.persist();
        this.options.telemetry.onDropped(batch.length, cause.message);
        this.options.telemetry.onError(`Batch rejected: ${cause.message}`);
        return;
      }

      this.consecutiveFailures += 1;
      const retryAfter =
        cause instanceof RetryableDeliveryError && cause.retryAfterSeconds !== undefined
          ? cause.retryAfterSeconds * 1000
          : undefined;
      const delay = retryAfter ?? this.backoffDelay();
      this.options.telemetry.onError(cause instanceof Error ? cause.message : String(cause));
      this.options.scheduler.schedule(delay, () => void this.flush());
    }
  }

  /**
   * Exponential backoff with jitter.
   *
   * The jitter matters because every browser window running this extension
   * would otherwise retry against a recovering backend at the same instant.
   */
  private backoffDelay(): number {
    const exponential = this.baseDelayMs * 2 ** (this.consecutiveFailures - 1);
    const capped = Math.min(exponential, this.maxDelayMs);
    return Math.round(capped * (0.5 + Math.random() * 0.5));
  }

  /** Removes by id: new events may have been appended while the request ran. */
  private removeDelivered(batch: BrowserEvent[]): void {
    const delivered = new Set(batch.map((event) => event.id));
    this.buffer = this.buffer.filter((event) => !delivered.has(event.id));
  }

  private trimToCapacity(): void {
    const excess = this.buffer.length - this.maxBufferedEvents;
    if (excess <= 0) return;
    this.buffer.splice(0, excess);
    this.options.telemetry.onDropped(excess, 'buffer full');
  }

  private async persist(): Promise<void> {
    try {
      await this.options.storage.write(this.buffer);
    } catch (cause) {
      // Losing the mirror is survivable — the in-memory buffer still works for
      // as long as this worker lives — but it must not be silent.
      this.options.telemetry.onError(
        `Could not persist the event queue: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }
}
