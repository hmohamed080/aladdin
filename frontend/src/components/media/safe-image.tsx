"use client";

import { useEffect, useRef, useState, type ImgHTMLAttributes, type ReactNode } from "react";
import { refreshMediaUrl } from "@/lib/media/refresh-url";

/**
 * A plain `<img>` that never shows a broken-image glyph.
 *
 * Media URLs here are revocable application/edge URLs, so next/image is not
 * used. When the bytes fail to load this does the least surprising thing:
 *
 *  1. An EXPIRED edge URL (60-120 s tickets; a tab left open, a lazy image) is
 *     not a missing image. It asks the server once for a fresh URL, which
 *     re-authorizes the caller, and retries with it.
 *  2. Anything else, or a refresh the server declines, shows `fallback`.
 *
 * The failure is remembered per URL, so a new `src` gets a fresh attempt. An
 * image that failed before hydration never fires a React `onError`; the mount
 * check on `complete && naturalWidth === 0` covers that case.
 */
export type SafeImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string | null | undefined;
  fallback: ReactNode;
  /** Replaces the default refresh (edge-ticket re-issue); return null when the media is unavailable. */
  refresh?: (failedUrl: string) => Promise<string | null>;
};

export function SafeImage({ src, fallback, refresh = refreshMediaUrl, onError, srcSet, sizes, ...rest }: SafeImageProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ for: string; url: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const tried = useRef<string | null>(null);
  const ref = useRef<HTMLImageElement>(null);

  const url = src && fresh?.for === src ? fresh.url : src;

  function fail(failed: string) {
    if (src && tried.current !== src) {
      tried.current = src;
      setRefreshing(true);
      refresh(failed).then(
        (next) => {
          setRefreshing(false);
          if (next && next !== failed) setFresh({ for: src, url: next });
          else setFailedUrl(failed);
        },
        () => {
          setRefreshing(false);
          setFailedUrl(failed);
        },
      );
    } else {
      setFailedUrl(failed);
    }
  }

  useEffect(() => {
    const img = ref.current;
    if (url && img && img.complete && img.naturalWidth === 0 && failedUrl !== url) fail(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-check only when the URL changes
  }, [url]);

  if (!url || failedUrl === url || refreshing) return <>{fallback}</>;
  const original = url === src;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- revocable media URL, never optimiser-cached
    <img
      {...rest}
      ref={ref}
      src={url}
      srcSet={original ? srcSet : undefined}
      sizes={original ? sizes : undefined}
      onError={(e) => {
        onError?.(e);
        fail(url);
      }}
    />
  );
}
