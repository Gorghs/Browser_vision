import { visionAnalysisSchema } from '@vab/types';
import type { Logger } from '../lib/logger.js';
import { buildAnalysisPrompt, buildCorrection, extractJson } from './prompt.js';
import { AiResponseError, AiUnavailableError } from './types.js';
import type { AnalysisOutcome, PageAnalysisInput, VisionProvider } from './types.js';

/**
 * The application's view of AI.
 *
 * Owns everything that must be true regardless of provider: that a response is
 * parsed, validated against the schema, retried once with the problem explained,
 * and otherwise rejected. A model is never trusted to have returned valid JSON,
 * and an invalid response is never stored.
 *
 * Callers depend on this class, not on a provider. Swapping Gemini for OpenAI is
 * an environment variable.
 */
export class AIService {
  constructor(
    private readonly provider: VisionProvider | undefined,
    private readonly logger: Logger,
  ) {}

  /** Whether any provider is configured. Callers use this to skip work entirely. */
  get available(): boolean {
    return this.provider !== undefined;
  }

  get description(): string {
    return this.provider ? `${this.provider.name}/${this.provider.model}` : 'none';
  }

  async analyzePage(input: PageAnalysisInput): Promise<AnalysisOutcome> {
    const provider = this.provider;
    if (!provider) throw new AiUnavailableError('No AI provider is configured.');

    const prompt = buildAnalysisPrompt(input);
    let lastResponse = '';
    let lastProblem = 'The reply was not valid JSON matching the required shape.';

    // Two attempts: the first as asked, the second told what was wrong with the
    // first. A third would mostly buy latency — a model that has failed twice
    // with the problem spelled out is not about to succeed.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      lastResponse = await provider.complete({
        imageBase64: input.imageBase64,
        mimeType: input.mimeType,
        prompt,
        ...(attempt === 0 ? {} : { correction: buildCorrection(lastProblem) }),
      });

      const parsed = extractJson(lastResponse);
      if (parsed === undefined) {
        lastProblem = 'The reply did not contain a JSON object.';
        this.logger.warn('AI reply was not JSON', { provider: provider.name, attempt });
        continue;
      }

      const validated = visionAnalysisSchema.safeParse(parsed);
      if (validated.success) {
        return {
          analysis: validated.data,
          provider: provider.name,
          model: provider.model,
          raw: parsed,
        };
      }

      lastProblem = validated.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      this.logger.warn('AI reply failed validation', {
        provider: provider.name,
        attempt,
        problems: lastProblem,
      });
    }

    throw new AiResponseError(
      `${provider.name} did not return a valid analysis after two attempts: ${lastProblem}`,
      lastResponse.slice(0, 500),
    );
  }
}
