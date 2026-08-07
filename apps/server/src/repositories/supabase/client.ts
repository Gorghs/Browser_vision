import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The Supabase client, created with the service-role key.
 *
 * That key bypasses Row Level Security, which is why it exists only here, on
 * the backend, and never reaches the extension or the dashboard bundle.
 */
export function createSupabaseClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: {
      // A server has no user session to persist or refresh.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
