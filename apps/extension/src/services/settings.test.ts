import { beforeEach, describe, expect, it } from 'vitest';
import { installFakeChrome } from '../testing/fake-chrome.js';
import {
  DEFAULT_SETTINGS,
  isDomainBlocked,
  loadSettings,
  onSettingsChanged,
  saveSettings,
} from './settings.js';

beforeEach(() => {
  installFakeChrome();
});

describe('loadSettings', () => {
  it('returns defaults on a fresh install', async () => {
    await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('does not track until the user opts in', () => {
    expect(DEFAULT_SETTINGS.trackingEnabled).toBe(false);
  });

  it('does not record selected text until the user opts in', () => {
    expect(DEFAULT_SETTINGS.captureSelectedText).toBe(false);
  });

  it('fills in keys added since the stored settings were written', async () => {
    const chrome = installFakeChrome();
    chrome.__store.set('settings', { trackingEnabled: true });

    const settings = await loadSettings();

    expect(settings.trackingEnabled).toBe(true);
    expect(settings.apiBaseUrl).toBe(DEFAULT_SETTINGS.apiBaseUrl);
    expect(settings.blockedDomains).toEqual([]);
  });

  it('falls back to defaults when the stored value is not an object', async () => {
    const chrome = installFakeChrome();
    chrome.__store.set('settings', 'corrupted');

    await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });
});

describe('saveSettings', () => {
  it('merges a patch into what is already stored', async () => {
    await saveSettings({ trackingEnabled: true });
    await saveSettings({ apiBaseUrl: 'http://localhost:4000' });

    const settings = await loadSettings();
    expect(settings).toMatchObject({
      trackingEnabled: true,
      apiBaseUrl: 'http://localhost:4000',
    });
  });
});

describe('onSettingsChanged', () => {
  it('notifies subscribers when another context writes settings', async () => {
    const seen: boolean[] = [];
    onSettingsChanged((settings) => seen.push(settings.trackingEnabled));

    await saveSettings({ trackingEnabled: true });

    expect(seen).toEqual([true]);
  });

  it('stops notifying after unsubscribe', async () => {
    const seen: boolean[] = [];
    const unsubscribe = onSettingsChanged((settings) => seen.push(settings.trackingEnabled));
    unsubscribe();

    await saveSettings({ trackingEnabled: true });

    expect(seen).toEqual([]);
  });
});

describe('isDomainBlocked', () => {
  it('blocks an exact match', () => {
    expect(isDomainBlocked('bank.example.com', ['bank.example.com'])).toBe(true);
  });

  it('blocks subdomains of a blocked domain', () => {
    expect(isDomainBlocked('login.bank.example.com', ['bank.example.com'])).toBe(true);
  });

  it('does not block a domain that merely ends with the same letters', () => {
    expect(isDomainBlocked('notbank.example.com', ['bank.example.com'])).toBe(false);
  });

  it('ignores case, surrounding whitespace and a www prefix in the entry', () => {
    expect(isDomainBlocked('bank.example.com', ['  WWW.Bank.Example.com '])).toBe(true);
  });

  it('ignores blank lines left in the list', () => {
    expect(isDomainBlocked('example.com', ['', '   '])).toBe(false);
  });

  it('treats a missing domain as not blocked', () => {
    expect(isDomainBlocked(undefined, ['example.com'])).toBe(false);
  });
});
