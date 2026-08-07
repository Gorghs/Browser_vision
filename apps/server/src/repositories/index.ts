import type { AppConfig } from '../config/env.js';
import type { Logger } from '../lib/logger.js';
import { createMemoryRepositories } from './memory/index.js';
import { createSupabaseClient } from './supabase/client.js';
import { createSupabaseRepositories } from './supabase/index.js';
import type { Repositories } from './types.js';

/**
 * Chooses the storage backend.
 *
 * Supabase when credentials are present, in-memory otherwise — so the project
 * can be cloned and run end to end without an account. The fallback is
 * announced rather than silent, and `loadConfig` refuses to start a production
 * server without credentials, so it can never be reached by accident in one.
 */
export function createRepositories(config: AppConfig, logger: Logger): Repositories {
  if (!config.supabase) {
    logger.warn(
      'No Supabase credentials configured: using in-memory storage. Events are lost on restart.',
    );
    return createMemoryRepositories();
  }

  logger.info('Using Supabase storage', { url: config.supabase.url });
  return createSupabaseRepositories(
    createSupabaseClient(config.supabase.url, config.supabase.serviceRoleKey),
  );
}
