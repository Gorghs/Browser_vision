import { AiUnavailableError } from './types.js';
import type { VisionProvider, VisionRequest } from './types.js';

/**
 * OpenAI, over the chat completions API.
 *
 * Written against fetch for the same reasons as the Gemini provider: one JSON
 * document, no second SDK, and a wire format that can be read beside the other.
 */

const DEFAULT_MODEL = 'gpt-4o-mini';
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 60_000;

export interface OpenAiProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface OpenAiResponse {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  error?: { message?: string };
}

export function createOpenAiProvider(options: OpenAiProviderOptions): VisionProvider {
  const model = options.model ?? DEFAULT_MODEL;
  const doFetch = options.fetchImpl ?? fetch;
  const endpoint = options.baseUrl ?? ENDPOINT;

  return {
    name: 'openai',
    model,

    async complete(request: VisionRequest): Promise<string> {
      const prompt =
        request.correction === undefined
          ? request.prompt
          : `${request.prompt}\n\n${request.correction}`;

      const response = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          // The API-level JSON mode, matching what Gemini is asked for, so the
          // two providers fail in the same ways rather than different ones.
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${request.mimeType};base64,${request.imageBase64}`,
                    // Low detail is enough to identify a page and costs far
                    // fewer tokens than a full-resolution read.
                    detail: 'low',
                  },
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new AiUnavailableError(
          `OpenAI returned ${String(response.status)}: ${body.slice(0, 300)}`,
        );
      }

      const body = (await response.json()) as OpenAiResponse;
      if (body.error?.message !== undefined) {
        throw new AiUnavailableError(`OpenAI reported an error: ${body.error.message}`);
      }

      const text = body.choices?.[0]?.message?.content;
      if (text === undefined || text === '') {
        throw new AiUnavailableError('OpenAI returned no content.');
      }
      return text;
    },
  };
}
