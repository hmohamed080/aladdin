"use client";

import { useEffect, useRef, useState, type ImgHTMLAttributes, type ReactNode } from "react";

/**
 * A plain `<img>` that never shows a broken-image glyph.
 *
 * Media URLs here are revocable application/edge URLs, so next/image is not
 * used. When the bytes are missing, expired or unauthorised the browser fires
 * `error`; this swaps in `fallback` instead. The failure is remembered per
 * `src`, so a new URL (for example after a refresh) gets a fresh attempt.
 *
 * An image that failed before hydration never fires a React `onError`; the
 * mount check on `complete && naturalWidth === 0` covers that case.
 */
export type SafeImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string | null | undefined;
  fallback: ReactNode;
  /** Called once per failing `src`, e.g. to ask the server for a fresh URL. */
  onFail?: () => void;
};

export function SafeImage({ src, fallback, onFail, onError, ...rest }: SafeImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = ref.current;
    if (src && img && img.complete && img.naturalWidth === 0 && failedSrc !== src) {
      setFailedSrc(src);
      onFail?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-check only when the URL changes
  }, [src]);

  if (!src || failedSrc === src) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- revocable media URL, never optimiser-cached
    <img
      {...rest}
      ref={ref}
      src={src}
      onError={(e) => {
        setFailedSrc(src);
        onError?.(e);
        onFail?.();
      }}
    />
  );
}
