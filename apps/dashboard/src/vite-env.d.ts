/// <reference types="vite/client" />

/**
 * Only variables prefixed with VITE_ reach the browser bundle, and everything
 * here is deliberately non-secret. The Supabase service-role key is never among
 * them: it stays on the backend, which is the whole reason the dashboard reads
 * through the REST API rather than the database.
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** The same shared key the extension sends; not a user credential. */
  readonly VITE_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
