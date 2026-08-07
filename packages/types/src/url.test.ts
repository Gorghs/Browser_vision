import { describe, expect, it } from 'vitest';
import { extractDomain, isTrackableUrl, sanitizeUrl } from './url.js';

describe('extractDomain', () => {
  it('lowercases the host and drops a www prefix', () => {
    expect(extractDomain('https://WWW.GitHub.com/vercel/next.js')).toBe('github.com');
  });

  it('keeps subdomains other than www', () => {
    expect(extractDomain('https://docs.github.com/en')).toBe('docs.github.com');
  });

  it('returns undefined for a malformed url', () => {
    expect(extractDomain('not a url')).toBeUndefined();
  });
});

describe('isTrackableUrl', () => {
  it.each(['https://example.com', 'http://localhost:3000/dashboard'])('accepts %s', (url) => {
    expect(isTrackableUrl(url)).toBe(true);
  });

  it.each([
    'chrome://extensions',
    'chrome-extension://abcdef/popup.html',
    'about:blank',
    'file:///home/user/secret.pdf',
    'devtools://devtools/bundled/inspector.html',
    'view-source:https://example.com',
    'data:text/html,<h1>hi</h1>',
  ])('rejects %s', (url) => {
    expect(isTrackableUrl(url)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isTrackableUrl(undefined)).toBe(false);
  });
});

describe('sanitizeUrl', () => {
  it('removes the query string, which is where tokens and search terms live', () => {
    expect(sanitizeUrl('https://mail.example.com/reset?token=abc123&email=a@b.com')).toBe(
      'https://mail.example.com/reset',
    );
  });

  it('removes the fragment', () => {
    expect(sanitizeUrl('https://example.com/docs#section-4')).toBe('https://example.com/docs');
  });

  it('keeps a non-default port, which distinguishes local services', () => {
    expect(sanitizeUrl('http://localhost:5173/events?q=1')).toBe('http://localhost:5173/events');
  });

  it('truncates to the requested length', () => {
    const long = `https://example.com/${'a'.repeat(200)}`;
    expect(sanitizeUrl(long, 40)).toHaveLength(40);
  });

  it('returns undefined for a malformed url', () => {
    expect(sanitizeUrl('://broken')).toBeUndefined();
  });
});
