import { describe, expect, it, vi } from 'vitest';
import { createGeminiProvider } from './gemini-provider.js';
import { createOpenAiProvider } from './openai-provider.js';
import { AiUnavailableError } from './types.js';

/**
 * Tests the wire format each provider builds and the responses it accepts.
 *
 * `fetch` is stubbed, so no request reaches a vendor. That leaves the real API
 * contract itself unverified — see ARCHITECTURE.md — but it does check the parts
 * this codebase is responsible for: that the image is attached in the shape the
 * API documents, that JSON mode is requested, and that a failure is classified
 * rather than thrown raw.
 */

const request = {
  imageBase64: 'AAAA',
  mimeType: 'image/jpeg',
  prompt: 'Describe this page.',
};

function stubFetch(response: { ok?: boolean; status?: number; body: unknown }) {
  return vi.fn((..._args: Parameters<typeof fetch>) =>
    Promise.resolve({
      ok: response.ok ?? true,
      status: response.status ?? 200,
      statusText: 'Test',
      json: () => Promise.resolve(response.body),
      text: () => Promise.resolve(JSON.stringify(response.body)),
    } as Response),
  );
}

function bodyOf(fetchImpl: ReturnType<typeof stubFetch>): Record<string, unknown> {
  const init = fetchImpl.mock.calls[0]?.[1];
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe('Gemini', () => {
  const reply = { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] };

  it('returns the model text', async () => {
    const fetchImpl = stubFetch({ body: reply });
    const provider = createGeminiProvider({ apiKey: 'key', fetchImpl });

    await expect(provider.complete(request)).resolves.toBe('{"ok":true}');
  });

  it('sends the image inline, as the API expects', async () => {
    const fetchImpl = stubFetch({ body: reply });

    await createGeminiProvider({ apiKey: 'key', fetchImpl }).complete(request);

    const contents = bodyOf(fetchImpl).contents as { parts: Record<string, unknown>[] }[];
    expect(contents[0]?.parts[1]).toEqual({
      inline_data: { mime_type: 'image/jpeg', data: 'AAAA' },
    });
  });

  it('asks for JSON at the API level', async () => {
    const fetchImpl = stubFetch({ body: reply });

    await createGeminiProvider({ apiKey: 'key', fetchImpl }).complete(request);

    expect(bodyOf(fetchImpl).generationConfig).toMatchObject({
      responseMimeType: 'application/json',
    });
  });

  it('appends the correction on a retry', async () => {
    const fetchImpl = stubFetch({ body: reply });

    await createGeminiProvider({ apiKey: 'key', fetchImpl }).complete({
      ...request,
      correction: 'That was not JSON.',
    });

    const contents = bodyOf(fetchImpl).contents as { parts: { text?: string }[] }[];
    expect(contents[0]?.parts[0]?.text).toContain('That was not JSON.');
  });

  it('uses the configured model in the URL', async () => {
    const fetchImpl = stubFetch({ body: reply });

    await createGeminiProvider({ apiKey: 'key', model: 'gemini-x', fetchImpl }).complete(request);

    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('gemini-x');
  });

  it('reports an HTTP failure as unavailable', async () => {
    const fetchImpl = stubFetch({ ok: false, status: 429, body: { error: 'rate limited' } });

    await expect(
      createGeminiProvider({ apiKey: 'key', fetchImpl }).complete(request),
    ).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('reports a safety block rather than returning empty text', async () => {
    const fetchImpl = stubFetch({ body: { promptFeedback: { blockReason: 'SAFETY' } } });

    await expect(
      createGeminiProvider({ apiKey: 'key', fetchImpl }).complete(request),
    ).rejects.toThrow(/SAFETY/);
  });

  it('reports an empty candidate list', async () => {
    const fetchImpl = stubFetch({ body: { candidates: [] } });

    await expect(
      createGeminiProvider({ apiKey: 'key', fetchImpl }).complete(request),
    ).rejects.toBeInstanceOf(AiUnavailableError);
  });
});

describe('OpenAI', () => {
  const reply = { choices: [{ message: { content: '{"ok":true}' } }] };

  it('returns the model text', async () => {
    const fetchImpl = stubFetch({ body: reply });

    await expect(
      createOpenAiProvider({ apiKey: 'key', fetchImpl }).complete(request),
    ).resolves.toBe('{"ok":true}');
  });

  it('sends the image as a data url, as the API expects', async () => {
    const fetchImpl = stubFetch({ body: reply });

    await createOpenAiProvider({ apiKey: 'key', fetchImpl }).complete(request);

    const messages = bodyOf(fetchImpl).messages as { content: Record<string, unknown>[] }[];
    expect(messages[0]?.content[1]).toMatchObject({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,AAAA' },
    });
  });

  it('asks for low detail, which is enough to identify a page', async () => {
    const fetchImpl = stubFetch({ body: reply });

    await createOpenAiProvider({ apiKey: 'key', fetchImpl }).complete(request);

    const messages = bodyOf(fetchImpl).messages as {
      content: { image_url?: { detail?: string } }[];
    }[];
    expect(messages[0]?.content[1]?.image_url?.detail).toBe('low');
  });

  it('asks for JSON at the API level', async () => {
    const fetchImpl = stubFetch({ body: reply });

    await createOpenAiProvider({ apiKey: 'key', fetchImpl }).complete(request);

    expect(bodyOf(fetchImpl).response_format).toEqual({ type: 'json_object' });
  });

  it('sends the key as a bearer token', async () => {
    const fetchImpl = stubFetch({ body: reply });

    await createOpenAiProvider({ apiKey: 'secret', fetchImpl }).complete(request);

    const init = fetchImpl.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer secret');
  });

  it('reports an HTTP failure as unavailable', async () => {
    const fetchImpl = stubFetch({ ok: false, status: 401, body: { error: 'bad key' } });

    await expect(
      createOpenAiProvider({ apiKey: 'key', fetchImpl }).complete(request),
    ).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('reports an error carried in a 200 response', async () => {
    const fetchImpl = stubFetch({ body: { error: { message: 'context length exceeded' } } });

    await expect(
      createOpenAiProvider({ apiKey: 'key', fetchImpl }).complete(request),
    ).rejects.toThrow(/context length/);
  });

  it('reports an empty choice list', async () => {
    const fetchImpl = stubFetch({ body: { choices: [] } });

    await expect(
      createOpenAiProvider({ apiKey: 'key', fetchImpl }).complete(request),
    ).rejects.toBeInstanceOf(AiUnavailableError);
  });
});

describe('both providers', () => {
  it('are interchangeable behind the interface', () => {
    const gemini = createGeminiProvider({ apiKey: 'key' });
    const openai = createOpenAiProvider({ apiKey: 'key' });

    // Same shape, different names: what makes provider choice configuration.
    expect(Object.keys(gemini).sort()).toEqual(Object.keys(openai).sort());
    expect(gemini.name).not.toBe(openai.name);
  });
});
