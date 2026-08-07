import type { Express } from 'express';
import { createApp } from '../app.js';
import type { AppConfig } from '../config/env.js';
import { createLogger } from '../lib/logger.js';
import { createMemoryRepositories } from '../repositories/memory/index.js';
import type { Repositories } from '../repositories/types.js';

/**
 * Builds a real Express app backed by in-memory storage.
 *
 * Tests drive the actual middleware stack, routes, controllers and services
 * over HTTP; only the database is substituted. That keeps them fast while still
 * exercising validation, authentication and error translation for real.
 */
export interface Harness {
  app: Express;
  repositories: Repositories;
  logs: string[];
}

export function createTestApp(overrides: Partial<AppConfig> = {}): Harness {
  const logs: string[] = [];
  // 'warn' so startup warnings are captured, but not the per-request info log.
  const logger = createLogger({ level: 'warn', write: (line) => logs.push(line) });
  const repositories = createMemoryRepositories();

  const config: AppConfig = {
    nodeEnv: 'test',
    port: 0,
    logLevel: 'warn',
    corsOrigins: ['http://localhost:5173'],
    apiKey: undefined,
    supabase: undefined,
    ...overrides,
  };

  return { app: createApp({ config, repositories, logger }), repositories, logs };
}

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
export const INSTALLATION_ID = '22222222-2222-4222-8222-222222222222';

let eventCounter = 0;

/** Builds a valid event, with a fresh id unless one is supplied. */
export function anEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  eventCounter += 1;
  return {
    id: `33333333-3333-4333-8333-${String(eventCounter).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    type: 'PAGE_LOADED',
    timestamp: new Date(Date.UTC(2026, 7, 7, 10, 0, eventCounter)).toISOString(),
    url: 'https://example.com/docs',
    domain: 'example.com',
    metadata: {},
    ...overrides,
  };
}

export function aBatch(events: Record<string, unknown>[]): Record<string, unknown> {
  return { installationId: INSTALLATION_ID, events };
}

export { SESSION_ID };
