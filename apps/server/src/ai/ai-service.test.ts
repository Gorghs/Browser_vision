import { describe, expect, it, vi } from 'vitest';
import { AIService } from './ai-service.js';
import { extractJson } from './prompt.js';
import { AiResponseError, AiUnavailableError } from './types.js';
import type { VisionProvider, VisionRequest } from './types.js';
import { createLogger } from '../lib/logger.js';

const VALID_ANALYSIS = {
  page: {
    pageType: 'github_issue',
    category: 'development',
    purpose: 'Reading a bug report',
    importantElements: ['issue title'],
  },
  activity: {
    userIntent: 'Understand the bug',
    currentTask: 'Investigating a caching bug',
    activityCategory: 'development',
    summary: 'Reading a GitHub issue',
  },
};

function silentLogger() {
  return createLogger({ level: 'error', write: () => undefined });
}

function providerReturning(...responses: string[]) {
  let index = 0;
  const complete = vi.fn((_input: VisionRequest) => {
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return Promise.resolve(response ?? '');
  });

  return {
    name: 'stub',
    model: 'stub-1',
    complete,
    get calls() {
      return complete.mock.calls.length;
    },
  } satisfies VisionProvider & { calls: number };
}

const input = { imageBase64: 'AAAA', mimeType: 'image/jpeg' };

describe('availability', () => {
  it('reports unavailable when no provider is configured', () => {
    expect(new AIService(undefined, silentLogger()).available).toBe(false);
  });

  it('refuses to analyse without a provider rather than inventing a result', async () => {
    const service = new AIService(undefined, silentLogger());

    await expect(service.analyzePage(input)).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('names the provider and model it will use', () => {
    const service = new AIService(providerReturning('{}'), silentLogger());

    expect(service.description).toBe('stub/stub-1');
  });
});

describe('valid responses', () => {
  it('returns a validated analysis', async () => {
    const service = new AIService(
      providerReturning(JSON.stringify(VALID_ANALYSIS)),
      silentLogger(),
    );

    const outcome = await service.analyzePage(input);

    expect(outcome.analysis.page.pageType).toBe('github_issue');
    expect(outcome.provider).toBe('stub');
    expect(outcome.model).toBe('stub-1');
  });

  it('keeps what the model actually returned', async () => {
    const service = new AIService(
      providerReturning(JSON.stringify(VALID_ANALYSIS)),
      silentLogger(),
    );

    const outcome = await service.analyzePage(input);

    expect(outcome.raw).toMatchObject({ page: { pageType: 'github_issue' } });
  });

  it('accepts a response wrapped in a code fence', async () => {
    const fenced = `\`\`\`json\n${JSON.stringify(VALID_ANALYSIS)}\n\`\`\``;
    const service = new AIService(providerReturning(fenced), silentLogger());

    await expect(service.analyzePage(input)).resolves.toBeDefined();
  });

  it('accepts a response prefaced with a sentence', async () => {
    const chatty = `Here is the analysis:\n${JSON.stringify(VALID_ANALYSIS)}`;
    const service = new AIService(providerReturning(chatty), silentLogger());

    await expect(service.analyzePage(input)).resolves.toBeDefined();
  });

  it('does not retry when the first reply is valid', async () => {
    const provider = providerReturning(JSON.stringify(VALID_ANALYSIS));

    await new AIService(provider, silentLogger()).analyzePage(input);

    expect(provider.calls).toBe(1);
  });
});

describe('invalid responses', () => {
  it('retries once with the problem explained', async () => {
    const provider = providerReturning('not json at all', JSON.stringify(VALID_ANALYSIS));

    const outcome = await new AIService(provider, silentLogger()).analyzePage(input);

    expect(provider.calls).toBe(2);
    expect(outcome.analysis.activity.currentTask).toBe('Investigating a caching bug');
  });

  it('tells the model what was wrong on the second attempt', async () => {
    const provider = providerReturning('nonsense', JSON.stringify(VALID_ANALYSIS));

    await new AIService(provider, silentLogger()).analyzePage(input);

    const second = provider.complete.mock.calls[1]?.[0] as { correction?: string } | undefined;
    expect(second?.correction).toContain('previous reply could not be used');
  });

  it('rejects a response that parses but fails the schema', async () => {
    const wrongShape = JSON.stringify({ page: { pageType: 'x' }, activity: {} });
    const service = new AIService(providerReturning(wrongShape), silentLogger());

    await expect(service.analyzePage(input)).rejects.toBeInstanceOf(AiResponseError);
  });

  it('rejects a category the model invented', async () => {
    const invented = JSON.stringify({
      ...VALID_ANALYSIS,
      page: { ...VALID_ANALYSIS.page, category: 'vibes' },
    });
    const service = new AIService(providerReturning(invented), silentLogger());

    await expect(service.analyzePage(input)).rejects.toBeInstanceOf(AiResponseError);
  });

  it('gives up after two attempts rather than looping', async () => {
    const provider = providerReturning('nope', 'still nope', 'and again');

    await expect(new AIService(provider, silentLogger()).analyzePage(input)).rejects.toThrow();
    expect(provider.calls).toBe(2);
  });

  it('reports what the model last said, so a failure can be diagnosed', async () => {
    const provider = providerReturning('I cannot help with that.');

    await expect(new AIService(provider, silentLogger()).analyzePage(input)).rejects.toMatchObject({
      lastResponse: 'I cannot help with that.',
    });
  });

  it('lets a provider outage surface as unavailable, not as a bad response', async () => {
    const provider: VisionProvider = {
      name: 'stub',
      model: 'stub-1',
      complete: () => Promise.reject(new AiUnavailableError('429 rate limited')),
    };

    await expect(new AIService(provider, silentLogger()).analyzePage(input)).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
  });
});

describe('extractJson', () => {
  it('parses a bare object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips a json code fence', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('strips an unlabelled code fence', () => {
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('recovers an object after a leading sentence', () => {
    expect(extractJson('Sure! {"a":1}')).toEqual({ a: 1 });
  });

  it('returns undefined when there is no object', () => {
    expect(extractJson('I am unable to assist.')).toBeUndefined();
  });

  it('returns undefined for malformed JSON', () => {
    expect(extractJson('{"a": }')).toBeUndefined();
  });
});
