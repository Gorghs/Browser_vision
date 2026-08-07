import { z } from 'zod';

/**
 * Environment configuration, validated once at startup.
 *
 * The process refuses to start on invalid configuration rather than failing on
 * the first request that happens to need it.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  /**
   * Supabase. Both must be set together — the service-role key is meaningless
   * without a URL — and when neither is set the server falls back to in-memory
   * storage so the pipeline can be exercised without an account.
   */
  SUPABASE_URL: z.url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  /**
   * Shared key the extension sends in `x-api-key`.
   *
   * Optional in development so the project runs out of the box, and required in
   * production, where an unauthenticated ingest endpoint would let anyone write
   * to the database.
   */
  API_KEY: z.string().min(16).optional(),

  /** Comma-separated origins allowed to call the API from a browser. */
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type RawEnv = z.infer<typeof envSchema>;

export interface AppConfig {
  nodeEnv: RawEnv['NODE_ENV'];
  port: number;
  logLevel: RawEnv['LOG_LEVEL'];
  corsOrigins: string[];
  apiKey: string | undefined;
  supabase: { url: string; serviceRoleKey: string } | undefined;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Invalid environment configuration:\n${issues}`);
  }

  const env = parsed.data;

  const hasUrl = env.SUPABASE_URL !== undefined;
  const hasKey = env.SUPABASE_SERVICE_ROLE_KEY !== undefined;
  if (hasUrl !== hasKey) {
    throw new ConfigError(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set together, or neither.',
    );
  }

  if (env.NODE_ENV === 'production') {
    if (!hasUrl) {
      throw new ConfigError('Supabase credentials are required in production.');
    }
    if (env.API_KEY === undefined) {
      throw new ConfigError(
        'API_KEY is required in production: an unauthenticated ingest endpoint would accept writes from anyone.',
      );
    }
  }

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    apiKey: env.API_KEY,
    supabase:
      env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
        ? { url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }
        : undefined,
  };
}
