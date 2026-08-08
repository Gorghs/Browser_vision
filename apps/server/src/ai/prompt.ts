import { ACTIVITY_CATEGORIES } from '@vab/types';
import type { PageAnalysisInput } from './types.js';

/**
 * The analysis prompt.
 *
 * Kept in one place, shared by every provider, so a change to what is asked
 * applies uniformly and provider comparisons stay meaningful — two models given
 * different instructions cannot be compared.
 */

/** OCR text is truncated: a dense page can produce more than is useful. */
const MAX_OCR_CHARS = 3000;

const SCHEMA_DESCRIPTION = `{
  "page": {
    "pageType": "short slug, e.g. github_issue, api_reference, product_listing",
    "category": one of ${ACTIVITY_CATEGORIES.map((category) => `"${category}"`).join(', ')},
    "purpose": "one sentence on what this page is for",
    "importantElements": ["up to 10 short phrases naming what dominates the page"],
    "visibleContentSummary": "what the page is about, two sentences at most"
  },
  "activity": {
    "userIntent": "why this person is on this page",
    "currentTask": "the larger task this page is a step in",
    "activityCategory": one of the same category values,
    "summary": "one line a human would recognise as a description of this moment",
    "confidence": number between 0 and 1
  }
}`;

export function buildAnalysisPrompt(input: PageAnalysisInput): string {
  const context: string[] = [];
  if (input.pageUrl) context.push(`URL: ${input.pageUrl}`);
  if (input.pageTitle) context.push(`Page title: ${input.pageTitle}`);
  if (input.ocrText) {
    context.push(`Text extracted from the screenshot:\n${input.ocrText.slice(0, MAX_OCR_CHARS)}`);
  }

  return [
    'You are analysing a screenshot of a web page a person was looking at.',
    'Describe what the page is and what the person appears to be doing.',
    '',
    context.length > 0 ? `Context:\n${context.join('\n')}` : 'No additional context is available.',
    '',
    'Reply with a single JSON object and nothing else. No prose, no code fences.',
    'Use exactly this shape:',
    SCHEMA_DESCRIPTION,
    '',
    // Without this, models routinely narrate a blank or unreadable page as
    // though they could see it, which is worse than an honest low score.
    'If the screenshot is unreadable or nearly empty, say so plainly in the',
    'summary and give a low confidence rather than inventing detail.',
  ].join('\n');
}

/** Appended on a second attempt after an unusable first response. */
export function buildCorrection(problem: string): string {
  return [
    'Your previous reply could not be used:',
    problem,
    'Reply again with only the JSON object, matching the shape exactly.',
  ].join('\n');
}

/**
 * Pulls a JSON object out of a model's reply.
 *
 * Models wrap JSON in code fences or preface it with a sentence no matter how
 * firmly they are asked not to. Recovering the object is cheaper than spending a
 * retry on formatting.
 */
export function extractJson(response: string): unknown {
  const withoutFences = response
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  const attempt = (candidate: string): unknown => {
    try {
      return JSON.parse(candidate);
    } catch {
      return undefined;
    }
  };

  const direct = attempt(withoutFences);
  if (direct !== undefined) return direct;

  // Fall back to the outermost braces, which handles a leading sentence.
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;

  return attempt(withoutFences.slice(start, end + 1));
}
