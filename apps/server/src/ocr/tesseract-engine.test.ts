import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../lib/logger.js';
import { createTesseractEngine } from './tesseract-engine.js';
import { countWords, tidyOcrText } from './types.js';

/**
 * The worker is injected, so these tests never load a language model.
 *
 * What is checked is this codebase's part: worker reuse, confidence conversion,
 * text tidying and shutdown. Tesseract's own accuracy is not under test.
 */

function silentLogger() {
  return createLogger({ level: 'error', write: () => undefined });
}

function stubWorker(data: {
  text: string;
  words?: { confidence?: number }[];
  confidence?: number;
}) {
  const terminate = vi.fn(() => Promise.resolve());
  const recognize = vi.fn(() => Promise.resolve({ data }));
  return { worker: { recognize, terminate }, recognize, terminate };
}

const IMAGE = new Uint8Array([1, 2, 3]);

describe('recognition', () => {
  it('returns the tidied text', async () => {
    const { worker } = stubWorker({ text: '  Router   cache  \n\n  not invalidating  ' });
    const engine = createTesseractEngine({
      logger: silentLogger(),
      createWorker: () => Promise.resolve(worker),
    });

    const result = await engine.recognize(IMAGE);

    expect(result.text).toBe('Router cache\nnot invalidating');
  });

  it('counts the words it extracted', async () => {
    const { worker } = stubWorker({ text: 'one two three four' });
    const engine = createTesseractEngine({
      logger: silentLogger(),
      createWorker: () => Promise.resolve(worker),
    });

    expect((await engine.recognize(IMAGE)).wordCount).toBe(4);
  });

  it('converts per-word confidence from a percentage to 0-1', async () => {
    const { worker } = stubWorker({
      text: 'hello',
      words: [{ confidence: 90 }, { confidence: 70 }],
    });
    const engine = createTesseractEngine({
      logger: silentLogger(),
      createWorker: () => Promise.resolve(worker),
    });

    expect((await engine.recognize(IMAGE)).meanConfidence).toBeCloseTo(0.8);
  });

  it('falls back to the overall confidence when there are no words', async () => {
    const { worker } = stubWorker({ text: 'hello', words: [], confidence: 55 });
    const engine = createTesseractEngine({
      logger: silentLogger(),
      createWorker: () => Promise.resolve(worker),
    });

    expect((await engine.recognize(IMAGE)).meanConfidence).toBeCloseTo(0.55);
  });

  it('reports null confidence when the engine gave none', async () => {
    const { worker } = stubWorker({ text: 'hello' });
    const engine = createTesseractEngine({
      logger: silentLogger(),
      createWorker: () => Promise.resolve(worker),
    });

    expect((await engine.recognize(IMAGE)).meanConfidence).toBeNull();
  });

  it('names the engine and language in the result', async () => {
    const { worker } = stubWorker({ text: 'hello' });
    const engine = createTesseractEngine({
      logger: silentLogger(),
      language: 'deu',
      createWorker: () => Promise.resolve(worker),
    });

    expect((await engine.recognize(IMAGE)).engine).toBe('tesseract.js:deu');
  });

  it('handles an image with no readable text', async () => {
    const { worker } = stubWorker({ text: '   \n \n  ' });
    const engine = createTesseractEngine({
      logger: silentLogger(),
      createWorker: () => Promise.resolve(worker),
    });

    const result = await engine.recognize(IMAGE);

    expect(result.text).toBe('');
    expect(result.wordCount).toBe(0);
  });
});

describe('worker lifecycle', () => {
  it('starts the worker only when first asked, not at construction', () => {
    const createWorker = vi.fn(() => Promise.resolve(stubWorker({ text: '' }).worker));

    createTesseractEngine({ logger: silentLogger(), createWorker });

    expect(createWorker).not.toHaveBeenCalled();
  });

  it('reuses the worker across images, since starting one is expensive', async () => {
    const { worker } = stubWorker({ text: 'hello' });
    const createWorker = vi.fn(() => Promise.resolve(worker));
    const engine = createTesseractEngine({ logger: silentLogger(), createWorker });

    await engine.recognize(IMAGE);
    await engine.recognize(IMAGE);

    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it('terminates the worker on shutdown', async () => {
    const { worker, terminate } = stubWorker({ text: 'hello' });
    const engine = createTesseractEngine({
      logger: silentLogger(),
      createWorker: () => Promise.resolve(worker),
    });
    await engine.recognize(IMAGE);

    await engine.shutdown();

    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('is safe to shut down without ever having started', async () => {
    const engine = createTesseractEngine({
      logger: silentLogger(),
      createWorker: () => Promise.resolve(stubWorker({ text: '' }).worker),
    });

    await expect(engine.shutdown()).resolves.toBeUndefined();
  });

  it('retries startup after a transient failure rather than staying poisoned', async () => {
    const { worker } = stubWorker({ text: 'hello' });
    const createWorker = vi
      .fn<() => Promise<typeof worker>>()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue(worker);
    const engine = createTesseractEngine({ logger: silentLogger(), createWorker });

    await expect(engine.recognize(IMAGE)).rejects.toThrow('network down');
    await expect(engine.recognize(IMAGE)).resolves.toBeDefined();
  });
});

describe('tidyOcrText', () => {
  it('collapses runs of whitespace within a line', () => {
    expect(tidyOcrText('a     b')).toBe('a b');
  });

  it('drops single-character lines, which are icons and borders', () => {
    expect(tidyOcrText('Real text\n|\n-\nMore text')).toBe('Real text\nMore text');
  });

  it('truncates very long output', () => {
    expect(tidyOcrText('word '.repeat(5000), 100)).toHaveLength(100);
  });

  it('returns an empty string for whitespace only', () => {
    expect(tidyOcrText('  \n \n ')).toBe('');
  });
});

describe('countWords', () => {
  it.each([
    ['', 0],
    ['   ', 0],
    ['one', 1],
    ['one two  three', 3],
  ])('counts %o as %i', (text, expected) => {
    expect(countWords(text)).toBe(expected);
  });
});
