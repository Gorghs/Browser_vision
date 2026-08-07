import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './env.js';

const SUPABASE = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

describe('defaults', () => {
  it('runs in development on port 3000 with no configuration at all', () => {
    expect(loadConfig({})).toMatchObject({ nodeEnv: 'development', port: 3000 });
  });

  it('falls back to no Supabase, which selects in-memory storage', () => {
    expect(loadConfig({}).supabase).toBeUndefined();
  });

  it('splits and trims the CORS origin list', () => {
    const config = loadConfig({ CORS_ORIGINS: 'http://a.test, http://b.test ' });

    expect(config.corsOrigins).toEqual(['http://a.test', 'http://b.test']);
  });
});

describe('validation', () => {
  it('rejects a port that is not a number', () => {
    expect(() => loadConfig({ PORT: 'http' })).toThrow(ConfigError);
  });

  it('rejects a port outside the valid range', () => {
    expect(() => loadConfig({ PORT: '99999' })).toThrow(ConfigError);
  });

  it('rejects a Supabase URL that is not a URL', () => {
    expect(() => loadConfig({ SUPABASE_URL: 'not-a-url', SUPABASE_SERVICE_ROLE_KEY: 'k' })).toThrow(
      ConfigError,
    );
  });

  it('rejects an API key too short to be worth having', () => {
    expect(() => loadConfig({ API_KEY: 'short' })).toThrow(ConfigError);
  });

  it('names the offending variable in the message', () => {
    expect(() => loadConfig({ PORT: 'http' })).toThrow(/PORT/);
  });
});

describe('Supabase credentials', () => {
  it('rejects a URL with no key', () => {
    expect(() => loadConfig({ SUPABASE_URL: 'https://project.supabase.co' })).toThrow(
      /must be set together/,
    );
  });

  it('rejects a key with no URL', () => {
    expect(() => loadConfig({ SUPABASE_SERVICE_ROLE_KEY: 'key' })).toThrow(/must be set together/);
  });

  it('accepts both together', () => {
    expect(loadConfig(SUPABASE).supabase).toEqual({
      url: 'https://project.supabase.co',
      serviceRoleKey: 'service-role-key',
    });
  });
});

describe('production', () => {
  const production = { NODE_ENV: 'production', API_KEY: 'a-sufficiently-long-key' };

  it('refuses to start without a database', () => {
    expect(() => loadConfig(production)).toThrow(/Supabase credentials are required/);
  });

  it('refuses to start without an API key, which would leave ingest open', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', ...SUPABASE })).toThrow(
      /API_KEY is required/,
    );
  });

  it('starts when both are provided', () => {
    expect(() => loadConfig({ ...production, ...SUPABASE })).not.toThrow();
  });

  it('allows an unauthenticated server in development', () => {
    expect(() => loadConfig({ NODE_ENV: 'development' })).not.toThrow();
  });
});
