import { AiUnavailableError } from './types.js';
import type { VisionProvider, VisionRequest } from './types.js';

/**
 * Google Gemini, over its REST API.
 *
 * Written against fetch rather than the vendor SDK. The request is one JSON
 * document, the SDK would be a second large dependency doing the same thing, and
 * having the wire format visible makes the two providers directly comparable.
 */

const DEFAULT_MODEL = 'gemini-2.5-flash';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 60_000;

export interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  promptFeedback?: { blockReason?: string };
}

export function createGeminiProvider(options: GeminiProviderOptions): VisionProvider {
  const model = options.model ?? DEFAULT_MODEL;
  const doFetch = options.fetchImpl ?? fetch;

  return {
    name: 'gemini',
    model,

    async complete(request: VisionRequest): Promise<string> {
      const prompt =
        request.correction === undefined
          ? request.prompt
          : `${request.prompt}\n\n${request.correction}`;

      const response = await doFetch(
        `${ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(options.apiKey)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  { inline_data: { mime_type: request.mimeType, data: request.imageBase64 } },
                ],
              },
            ],
            generationConfig: {
              // Asking for JSON at the API level removes a whole class of
              // formatting failure before the parser ever sees the reply.
              responseMimeType: 'application/json',
              temperature: 0.2,
            },
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new AiUnavailableError(
          `Gemini returned ${String(response.status)}: ${body.slice(0, 300)}`,
        );
      }

      const body = (await response.json()) as GeminiResponse;

      if (body.promptFeedback?.blockReason !== undefined) {
        throw new AiUnavailableError(
          `Gemini refused the request: ${body.promptFeedback.blockReason}`,
        );
      }

      const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text === undefined || text === '') {
        throw new AiUnavailableError('Gemini returned no content.');
      }
      return text;
    },
  };
}
