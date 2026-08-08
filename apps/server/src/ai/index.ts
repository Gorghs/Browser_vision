import type { AppConfig } from '../config/env.js';
import type { Logger } from '../lib/logger.js';
import { AIService } from './ai-service.js';
import { createGeminiProvider } from './gemini-provider.js';
import { createOpenAiProvider } from './openai-provider.js';
import type { VisionProvider } from './types.js';

/**
 * Selects the vision provider from configuration.
 *
 * The only place in the codebase that knows both providers exist. Everything
 * downstream holds an `AIService` and cannot tell which one it got.
 */
export function createAIService(config: AppConfig, logger: Logger): AIService {
  const provider = selectProvider(config, logger);
  if (provider) {
    logger.info('Vision analysis enabled', { provider: provider.name, model: provider.model });
  } else {
    // Not an error. The telemetry and timeline layers work without it, so this
    // is a statement of what the server will and will not do.
    logger.info('No AI provider configured: screenshots will be captured and read, not analysed.');
  }
  return new AIService(provider, logger);
}

function selectProvider(config: AppConfig, logger: Logger): VisionProvider | undefined {
  const { ai } = config;
  if (!ai) return undefined;

  if (ai.provider === 'gemini') {
    if (ai.baseUrl !== undefined) {
      // Gemini's endpoint encodes the model and uses a different auth scheme,
      // so an override would silently not apply rather than doing what it says.
      logger.warn('AI_BASE_URL is ignored for Gemini; it applies to OpenAI only.');
    }
    return createGeminiProvider({
      apiKey: ai.apiKey,
      ...(ai.model !== undefined ? { model: ai.model } : {}),
    });
  }

  if (ai.provider === 'openai') {
    return createOpenAiProvider({
      apiKey: ai.apiKey,
      ...(ai.model !== undefined ? { model: ai.model } : {}),
      ...(ai.baseUrl !== undefined ? { baseUrl: ai.baseUrl } : {}),
    });
  }

  logger.warn('Unknown AI provider requested; continuing without one.', { provider: ai.provider });
  return undefined;
}

export { AIService } from './ai-service.js';
export * from './types.js';
