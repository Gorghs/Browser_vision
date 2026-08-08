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

  /**
   * Vision AI. Entirely optional: with no provider configured the server still
   * stores screenshots and reads them with OCR, and the timeline still builds
   * from events. Analysis is the only thing that stops.
   */
  AI_PROVIDER: z.enum(['gemini', 'openai']).optional(),
  AI_API_KEY: z.string().min(1).optional(),
  /** Overrides the provider's default model. */
  AI_MODEL: z.string().min(1).optional(),
  /**
   * Overrides the provider's endpoint.
   *
   * OpenAI-compatible endpoints are common — Azure, proxies, locally hosted
   * models — and pointing at one is the only way to exercise the provider
   * without a vendor account. OpenAI only; Gemini's URL encodes the model.
   */
  AI_BASE_URL: z.url().optional(),

  /** Set false to store screenshots without ever reading them. */
  OCR_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  /** Supabase Storage bucket holding screenshot images. */
  SCREENSHOT_BUCKET: z.string().min(1).default('screenshots'),
  /** Where images go when Supabase is not configured. */
  SCREENSHOT_DIR: z.string().min(1).default('.data/screenshots'),

  /** How often the analysis worker looks for new screenshots. 0 disables it. */
  ANALYSIS_INTERVAL_MS: z.coerce.number().int().min(0).max(3_600_000).default(15_000),
});

export type RawEnv = z.infer<typeof envSchema>;

export interface AppConfig {
  nodeEnv: RawEnv['NODE_ENV'];
  port: number;
  logLevel: RawEnv['LOG_LEVEL'];
  corsOrigins: string[];
  apiKey: string | undefined;
  supabase: { url: string; serviceRoleKey: string } | undefined;
  ai:
    | {
        provider: 'gemini' | 'openai';
        apiKey: string;
        model: string | undefined;
        baseUrl: string | undefined;
      }
    | undefined;
  ocrEnabled: boolean;
  screenshotBucket: string;
  screenshotDir: string;
  analysisIntervalMs: number;
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

  // Same rule as the Supabase pair: a provider with no key cannot work, and a
  // key with no provider says nothing about which API to call. Failing here
  // beats failing on the first screenshot analysed hours later.
  const hasProvider = env.AI_PROVIDER !== undefined;
  const hasAiKey = env.AI_API_KEY !== undefined;
  if (hasProvider !== hasAiKey) {
    throw new ConfigError('AI_PROVIDER and AI_API_KEY must be set together, or neither.');
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
    ai:
      env.AI_PROVIDER && env.AI_API_KEY
        ? {
            provider: env.AI_PROVIDER,
            apiKey: env.AI_API_KEY,
            model: env.AI_MODEL,
            baseUrl: env.AI_BASE_URL,
          }
        : undefined,
    ocrEnabled: env.OCR_ENABLED,
    screenshotBucket: env.SCREENSHOT_BUCKET,
    screenshotDir: env.SCREENSHOT_DIR,
    analysisIntervalMs: env.ANALYSIS_INTERVAL_MS,
  };
}
