import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserEvent } from '@vab/types';
import { PermanentDeliveryError, RetryableDeliveryError } from './backend-client.js';
import { EventQueue } from './event-queue.js';
import type { QueueScheduler, QueueStorage, QueueTelemetry } from './event-queue.js';

function makeEvent(n: number): BrowserEvent {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    sessionId: '11111111-1111-4111-8111-111111111111',
    type: 'CLICK',
    timestamp: new Date(1_800_000_000_000 + n).toISOString(),
    metadata: {},
  };
}

function createHarness() {
  const stored: { events: BrowserEvent[] } = { events: [] };
  const storage: QueueStorage = {
    read: () => Promise.resolve([...stored.events]),
    write: (events) => {
      stored.events = [...events];
      return Promise.resolve();
    },
  };

  let scheduled: { delayMs: number; task: () => void } | null = null;
  const scheduler: QueueScheduler = {
    schedule: (delayMs, task) => {
      scheduled = { delayMs, task };
    },
    cancel: () => {
      scheduled = null;
    },
  };

  const telemetry: QueueTelemetry = {
    onDelivered: vi.fn(),
    onError: vi.fn(),
    onDropped: vi.fn(),
  };

  return {
    stored,
    storage,
    telemetry,
    scheduler,
    get scheduled() {
      return scheduled;
    },
    runScheduled: async () => {
      const pending = scheduled;
      scheduled = null;
      pending?.task();
      // The scheduled task starts an async flush it cannot await.
      await vi.waitFor(() => undefined);
    },
  };
}

const accepted = (events: BrowserEvent[]) =>
  Promise.resolve({ accepted: events.length, duplicates: 0 });

beforeEach(() => {
  // Removes jitter so backoff assertions are exact.
  vi.spyOn(Math, 'random').mockReturnValue(1);
});

describe('flush triggers', () => {
  it('does not send until the batch size is reached', async () => {
    const harness = createHarness();
    const send = vi.fn(accepted);
    const queue = new EventQueue({ ...harness, send, flushAtSize: 3 });

    await queue.enqueue(makeEvent(1));
    await queue.enqueue(makeEvent(2));

    expect(send).not.toHaveBeenCalled();
    expect(queue.size).toBe(2);
  });

  it('sends automatically once the batch size is reached', async () => {
    const harness = createHarness();
    const send = vi.fn(accepted);
    const queue = new EventQueue({ ...harness, send, flushAtSize: 3 });

    await queue.enqueue(makeEvent(1));
    await queue.enqueue(makeEvent(2));
    await queue.enqueue(makeEvent(3));

    expect(send).toHaveBeenCalledTimes(1);
    expect(queue.size).toBe(0);
  });

  it('does nothing when asked to flush an empty queue', async () => {
    const harness = createHarness();
    const send = vi.fn(accepted);

    await new EventQueue({ ...harness, send }).flush();

    expect(send).not.toHaveBeenCalled();
  });
});

describe('persistence across service worker restarts', () => {
  it('mirrors buffered events to storage', async () => {
    const harness = createHarness();
    const queue = new EventQueue({ ...harness, send: vi.fn(accepted), flushAtSize: 10 });

    await queue.enqueue(makeEvent(1));

    expect(harness.stored.events).toHaveLength(1);
  });

  it('recovers events left by a terminated worker', async () => {
    const harness = createHarness();
    harness.stored.events = [makeEvent(1), makeEvent(2)];
    const send = vi.fn(accepted);

    const queue = new EventQueue({ ...harness, send, flushAtSize: 10 });
    await queue.flush();

    expect(send).toHaveBeenCalledWith([makeEvent(1), makeEvent(2)]);
  });

  it('clears storage once events are delivered', async () => {
    const harness = createHarness();
    harness.stored.events = [makeEvent(1)];
    const queue = new EventQueue({ ...harness, send: vi.fn(accepted) });

    await queue.flush();

    expect(harness.stored.events).toEqual([]);
  });
});

describe('retryable failures', () => {
  it('keeps the events and schedules a retry', async () => {
    const harness = createHarness();
    const send = vi.fn().mockRejectedValue(new RetryableDeliveryError('offline'));
    const queue = new EventQueue({ ...harness, send, flushAtSize: 1 });

    await queue.enqueue(makeEvent(1));

    expect(queue.size).toBe(1);
    expect(harness.stored.events).toHaveLength(1);
    expect(harness.scheduled).not.toBeNull();
  });

  it('backs off exponentially across consecutive failures', async () => {
    const harness = createHarness();
    const send = vi.fn().mockRejectedValue(new RetryableDeliveryError('offline'));
    const queue = new EventQueue({
      ...harness,
      send,
      flushAtSize: 1,
      retry: { baseDelayMs: 1000 },
    });

    await queue.enqueue(makeEvent(1));
    const first = harness.scheduled?.delayMs;
    await queue.flush();
    const second = harness.scheduled?.delayMs;
    await queue.flush();
    const third = harness.scheduled?.delayMs;

    expect([first, second, third]).toEqual([1000, 2000, 4000]);
  });

  it('caps the backoff delay', async () => {
    const harness = createHarness();
    const send = vi.fn().mockRejectedValue(new RetryableDeliveryError('offline'));
    const queue = new EventQueue({
      ...harness,
      send,
      flushAtSize: 1,
      retry: { baseDelayMs: 1000, maxDelayMs: 3000 },
    });

    await queue.enqueue(makeEvent(1));
    for (let i = 0; i < 6; i++) await queue.flush();

    expect(harness.scheduled?.delayMs).toBe(3000);
  });

  it('honours a Retry-After hint instead of its own backoff', async () => {
    const harness = createHarness();
    const send = vi.fn().mockRejectedValue(new RetryableDeliveryError('slow down', 42));
    const queue = new EventQueue({ ...harness, send, flushAtSize: 1 });

    await queue.enqueue(makeEvent(1));

    expect(harness.scheduled?.delayMs).toBe(42_000);
  });

  it('delivers the held events when the retry succeeds', async () => {
    const harness = createHarness();
    const send = vi
      .fn()
      .mockRejectedValueOnce(new RetryableDeliveryError('offline'))
      .mockImplementation(accepted);
    const queue = new EventQueue({ ...harness, send, flushAtSize: 1 });

    await queue.enqueue(makeEvent(1));
    await harness.runScheduled();

    expect(queue.size).toBe(0);
    expect(harness.stored.events).toEqual([]);
  });

  it('cancels the pending retry after a success', async () => {
    const harness = createHarness();
    const send = vi
      .fn()
      .mockRejectedValueOnce(new RetryableDeliveryError('offline'))
      .mockImplementation(accepted);
    const queue = new EventQueue({ ...harness, send, flushAtSize: 1 });

    await queue.enqueue(makeEvent(1));
    await harness.runScheduled();

    expect(harness.scheduled).toBeNull();
  });
});

describe('permanent failures', () => {
  it('drops the rejected batch instead of blocking the queue behind it', async () => {
    const harness = createHarness();
    const send = vi.fn().mockRejectedValue(new PermanentDeliveryError('400 malformed', 400));
    const queue = new EventQueue({ ...harness, send, flushAtSize: 1 });

    await queue.enqueue(makeEvent(1));

    expect(queue.size).toBe(0);
    expect(harness.telemetry.onDropped).toHaveBeenCalledWith(1, '400 malformed');
  });

  it('reports the rejection rather than failing silently', async () => {
    const harness = createHarness();
    const send = vi.fn().mockRejectedValue(new PermanentDeliveryError('401 unauthorized', 401));
    const queue = new EventQueue({ ...harness, send, flushAtSize: 1 });

    await queue.enqueue(makeEvent(1));

    expect(harness.telemetry.onError).toHaveBeenCalledWith(
      expect.stringContaining('401 unauthorized'),
    );
  });
});

describe('buffer capacity', () => {
  it('drops the oldest events once the ceiling is reached', async () => {
    const harness = createHarness();
    const queue = new EventQueue({
      ...harness,
      send: vi.fn(accepted),
      flushAtSize: 100,
      maxBufferedEvents: 3,
    });

    for (let i = 1; i <= 5; i++) await queue.enqueue(makeEvent(i));

    expect(queue.size).toBe(3);
    expect(harness.stored.events.map((event) => event.id)).toEqual([
      makeEvent(3).id,
      makeEvent(4).id,
      makeEvent(5).id,
    ]);
  });

  it('reports how many events were dropped', async () => {
    const harness = createHarness();
    const queue = new EventQueue({
      ...harness,
      send: vi.fn(accepted),
      flushAtSize: 100,
      maxBufferedEvents: 2,
    });

    for (let i = 1; i <= 4; i++) await queue.enqueue(makeEvent(i));

    expect(harness.telemetry.onDropped).toHaveBeenCalledWith(1, 'buffer full');
  });
});

describe('batching', () => {
  it('never sends more than the ingest limit in one request', async () => {
    const harness = createHarness();
    const send = vi.fn(accepted);
    const queue = new EventQueue({ ...harness, send, flushAtSize: 10_000 });

    for (let i = 1; i <= 250; i++) await queue.enqueue(makeEvent(i));
    await queue.flush();

    expect(send.mock.calls[0]?.[0]).toHaveLength(200);
  });

  it('keeps events that arrive mid-request', async () => {
    const harness = createHarness();
    let release = () => {};
    let markSendCalled = () => {};
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sendCalled = new Promise<void>((resolve) => {
      markSendCalled = resolve;
    });
    const send = vi.fn(async (events: BrowserEvent[]) => {
      markSendCalled();
      await inFlight;
      return { accepted: events.length, duplicates: 0 };
    });
    // Large enough that enqueueing never triggers a flush of its own, so this
    // test controls exactly when the single in-flight request happens.
    const queue = new EventQueue({ ...harness, send, flushAtSize: 100 });

    await queue.enqueue(makeEvent(1));
    const flushing = queue.flush();
    await sendCalled;
    await queue.enqueue(makeEvent(2));
    release();
    await flushing;

    // The first event was delivered; the second must survive, rather than being
    // discarded along with it just because it arrived while the request was open.
    expect(send).toHaveBeenCalledTimes(1);
    expect(harness.stored.events.map((event) => event.id)).toEqual([makeEvent(2).id]);
  });
});

describe('telemetry', () => {
  it('reports delivered counts including server-side duplicates', async () => {
    const harness = createHarness();
    const send = vi.fn().mockResolvedValue({ accepted: 1, duplicates: 2 });
    const queue = new EventQueue({ ...harness, send, flushAtSize: 1 });

    await queue.enqueue(makeEvent(1));

    expect(harness.telemetry.onDelivered).toHaveBeenCalledWith(3, expect.any(Date));
  });

  it('reports a storage failure instead of swallowing it', async () => {
    const harness = createHarness();
    const queue = new EventQueue({
      ...harness,
      storage: {
        read: () => Promise.resolve([]),
        write: () => Promise.reject(new Error('quota exceeded')),
      },
      send: vi.fn(accepted),
      flushAtSize: 100,
    });

    await queue.enqueue(makeEvent(1));

    expect(harness.telemetry.onError).toHaveBeenCalledWith(
      expect.stringContaining('quota exceeded'),
    );
  });
});
