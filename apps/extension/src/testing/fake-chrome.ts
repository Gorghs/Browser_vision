import { vi } from 'vitest';

/**
 * A minimal stand-in for the Chrome extension APIs the extension actually uses.
 *
 * Real `chrome` bindings only exist inside an extension context, so unit tests
 * install this on `globalThis` instead. It is deliberately behavioural — the
 * storage area really stores — so tests assert on outcomes rather than on which
 * Chrome method happened to be called.
 */

type StorageChange = { oldValue?: unknown; newValue?: unknown };
type ChangeListener = (changes: Record<string, StorageChange>, areaName: string) => void;

export interface FakeChrome {
  storage: {
    local: {
      get: (key: string) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
      remove: (key: string) => Promise<void>;
    };
    onChanged: {
      addListener: (listener: ChangeListener) => void;
      removeListener: (listener: ChangeListener) => void;
    };
  };
  runtime: {
    sendMessage: ReturnType<typeof vi.fn>;
    onMessage: {
      addListener: (listener: unknown) => void;
      removeListener: (listener: unknown) => void;
    };
    lastError: { message: string } | undefined;
  };
  /** Test-only view of what is stored, for arranging state directly. */
  __store: Map<string, unknown>;
}

export function createFakeChrome(): FakeChrome {
  const store = new Map<string, unknown>();
  const changeListeners = new Set<ChangeListener>();
  const messageListeners = new Set<unknown>();

  const emit = (key: string, oldValue: unknown, newValue: unknown): void => {
    for (const listener of changeListeners) {
      listener({ [key]: { oldValue, newValue } }, 'local');
    }
  };

  return {
    storage: {
      local: {
        get: (key) => Promise.resolve(store.has(key) ? { [key]: store.get(key) } : {}),
        set: (items) => {
          for (const [key, value] of Object.entries(items)) {
            const oldValue = store.get(key);
            store.set(key, value);
            emit(key, oldValue, value);
          }
          return Promise.resolve();
        },
        remove: (key) => {
          const oldValue = store.get(key);
          store.delete(key);
          emit(key, oldValue, undefined);
          return Promise.resolve();
        },
      },
      onChanged: {
        addListener: (listener) => void changeListeners.add(listener),
        removeListener: (listener) => void changeListeners.delete(listener),
      },
    },
    runtime: {
      sendMessage: vi.fn(),
      onMessage: {
        addListener: (listener) => void messageListeners.add(listener),
        removeListener: (listener) => void messageListeners.delete(listener),
      },
      lastError: undefined,
    },
    __store: store,
  };
}

/** Installs a fresh fake on `globalThis.chrome` and returns it. */
export function installFakeChrome(): FakeChrome {
  const fake = createFakeChrome();
  (globalThis as unknown as { chrome: unknown }).chrome = fake;
  return fake;
}
