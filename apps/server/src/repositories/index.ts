import type { AppConfig } from '../config/env.js';
import type { Logger } from '../lib/logger.js';
import { createFilesystemObjectStore, createSupabaseObjectStore } from '../storage/object-store.js';
import type { ObjectStore } from '../storage/object-store.js';
import { createMemoryRepositories } from './memory/index.js';
import { createMemoryVisualRepositories } from './memory/visual.js';
import { createSupabaseClient } from './supabase/client.js';
import { createSupabaseRepositories } from './supabase/index.js';
import { createSupabaseVisualRepositories } from './supabase/visual.js';
import type { Repositories } from './types.js';
import type { VisualRepositories } from './visual-types.js';

export interface Persistence {
  repositories: Repositories;
  visual: VisualRepositories;
  store: ObjectStore;
}

/**
 * Chooses the storage backend.
 *
 * Supabase when credentials are present, in-memory plus the local filesystem
 * otherwise — so the project can be cloned and run end to end without an
 * account. The fallback is announced rather than silent, and `loadConfig`
 * refuses to start a production server without credentials, so it can never be
 * reached by accident in one.
 *
 * Event storage and image storage are chosen together on purpose. A server
 * writing rows to Postgres while writing images to a local directory would
 * produce a database full of paths that only exist on one machine.
 */
export function createPersistence(config: AppConfig, logger: Logger): Persistence {
  if (!config.supabase) {
    logger.warn(
      'No Supabase credentials configured: using in-memory storage. Events are lost on restart.',
    );
    logger.info('Screenshots will be written to disk', { directory: config.screenshotDir });
    return {
      repositories: createMemoryRepositories(),
      visual: createMemoryVisualRepositories(),
      store: createFilesystemObjectStore(config.screenshotDir),
    };
  }

  logger.info('Using Supabase storage', {
    url: config.supabase.url,
    bucket: config.screenshotBucket,
  });
  const client = createSupabaseClient(config.supabase.url, config.supabase.serviceRoleKey);

  return {
    repositories: createSupabaseRepositories(client),
    visual: createSupabaseVisualRepositories(client),
    store: createSupabaseObjectStore(client, config.screenshotBucket),
  };
}
