import { useEffect, useState } from 'react';
import { usePopupStore } from '../store/popup-store.js';
import { StatusPanel } from './components/StatusPanel.js';
import { Toggle } from './components/Toggle.js';

/** How often the popup re-reads status while it is open. */
const STATUS_POLL_MS = 2000;

export function App() {
  const {
    settings,
    status,
    loading,
    error,
    initialize,
    refreshStatus,
    setTracking,
    updateSettings,
    setVisualCapture,
    captureNow,
  } = usePopupStore();
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    const timer = setInterval(() => void refreshStatus(), STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [refreshStatus]);

  if (loading) {
    return <main className="p-4 text-sm text-slate-400">Loading…</main>;
  }

  const tracking = settings.trackingEnabled;

  return (
    <main className="flex flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold text-slate-100">Visual AI Browser Agent</h1>
          <p className="text-xs text-slate-400">
            {tracking ? 'Recording browser activity' : 'Not recording'}
          </p>
        </div>
        <span
          aria-hidden
          className={`h-2.5 w-2.5 rounded-full ${tracking ? 'bg-emerald-400' : 'bg-slate-600'}`}
        />
      </header>

      <Toggle
        label="Tracking"
        description="Collect sessions, tabs and navigation."
        checked={tracking}
        onChange={(checked) => void setTracking(checked)}
      />

      <Toggle
        label="Visual capture"
        description="Screenshot pages so they can be read and understood."
        checked={settings.visualCaptureEnabled}
        disabled={!tracking}
        onChange={(checked) => void setVisualCapture(checked)}
      />

      {settings.visualCaptureEnabled ? (
        <button
          type="button"
          onClick={() => void captureNow()}
          className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-1.5 text-xs text-slate-200 hover:border-[var(--color-accent)]"
        >
          Capture this page now
        </button>
      ) : null}

      <StatusPanel status={status} />

      <section className="border-t border-[var(--color-border-subtle)] pt-2">
        <button
          type="button"
          className="text-xs text-slate-400 hover:text-slate-200"
          onClick={() => setShowSettings((open) => !open)}
        >
          {showSettings ? 'Hide settings' : 'Privacy and connection settings'}
        </button>

        {showSettings ? (
          <div className="mt-2 flex flex-col gap-1">
            <Toggle
              label="Page interactions"
              description="Clicks, scrolling, focus and blur."
              checked={settings.trackInteractions}
              disabled={!tracking}
              onChange={(checked) => void updateSettings({ trackInteractions: checked })}
            />
            <Toggle
              label="Selected text"
              description="Record what was selected, not just that a selection happened."
              checked={settings.captureSelectedText}
              disabled={!tracking || !settings.trackInteractions}
              onChange={(checked) => void updateSettings({ captureSelectedText: checked })}
            />
            <Toggle
              label="Capture on page load"
              description="Otherwise screenshots are only taken when you ask."
              checked={settings.captureOnNavigation}
              disabled={!tracking || !settings.visualCaptureEnabled}
              onChange={(checked) => void updateSettings({ captureOnNavigation: checked })}
            />

            <label className="mt-2 flex flex-col gap-1">
              <span className="text-xs text-slate-400">Backend URL</span>
              <input
                type="url"
                value={settings.apiBaseUrl}
                spellCheck={false}
                className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-1 text-xs text-slate-100"
                onChange={(event) => void updateSettings({ apiBaseUrl: event.target.value })}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-400">API key</span>
              <input
                type="password"
                value={settings.apiKey}
                spellCheck={false}
                autoComplete="off"
                className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-1 text-xs text-slate-100"
                onChange={(event) => void updateSettings({ apiKey: event.target.value })}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-400">Never track these domains</span>
              <textarea
                rows={3}
                spellCheck={false}
                value={settings.blockedDomains.join('\n')}
                placeholder="bank.example.com"
                className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-1 text-xs text-slate-100"
                onChange={(event) =>
                  void updateSettings({
                    blockedDomains: event.target.value
                      .split('\n')
                      .map((line) => line.trim())
                      .filter(Boolean),
                  })
                }
              />
              <span className="text-[11px] text-slate-500">
                One per line. Subdomains are blocked too.
              </span>
            </label>
          </div>
        ) : null}
      </section>

      {error ? <p className="text-xs text-amber-300">{error}</p> : null}

      <p className="text-[11px] leading-relaxed text-slate-500">
        Keyboard input and form field contents are never recorded. URLs are stored without their
        query strings.
        {settings.visualCaptureEnabled
          ? ' Screenshots capture whatever is on screen, including anything visible on the page.'
          : ''}
      </p>
    </main>
  );
}
