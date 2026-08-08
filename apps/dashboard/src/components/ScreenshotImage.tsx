import { useEffect, useState } from 'react';
import { fetchScreenshotImage } from '../services/api.js';

interface ScreenshotImageProps {
  id: string;
  alt: string;
}

/**
 * Loads a screenshot through the authenticated API and shows it as an object URL.
 *
 * The image route requires `x-api-key` once the API is protected, which a plain
 * `<img src>` cannot send. The URL is owned by this component: it is revoked on
 * unmount or when the id changes, and the fallback text replaces it on failure.
 */
export function ScreenshotImage({ id, alt }: ScreenshotImageProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    void fetchScreenshotImage(id)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);

  if (failed) {
    return (
      <div className="flex aspect-video items-center justify-center bg-[var(--color-surface)] px-4 text-center text-xs text-slate-500">
        The screenshot could not be loaded.
      </div>
    );
  }

  return (
    <div className="flex aspect-video items-center justify-center bg-[var(--color-surface)]">
      {src === null ? (
        <span className="text-xs text-slate-500">Loading image…</span>
      ) : (
        <img src={src} alt={alt} className="max-h-full w-full object-contain" loading="lazy" />
      )}
    </div>
  );
}
