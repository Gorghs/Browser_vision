import type { Screenshot } from '@vab/types';
import { ScreenshotCard } from './ScreenshotCard.js';

export function ScreenshotGallery({
  screenshots,
  total,
}: {
  screenshots: Screenshot[];
  total: number;
}) {
  if (screenshots.length === 0) {
    return (
      <p className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-8 text-center text-sm text-slate-400">
        No screenshots yet. Enable visual capture in the extension popup and browse a little.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {screenshots.map((screenshot) => (
          <ScreenshotCard key={screenshot.id} screenshot={screenshot} />
        ))}
      </div>
      <p className="text-xs text-slate-500">
        Showing {String(screenshots.length)} of {String(total)} capture
        {total === 1 ? '' : 's'}.
      </p>
    </div>
  );
}
