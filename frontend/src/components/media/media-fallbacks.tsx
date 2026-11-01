"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { BuildingIcon, PackageIcon } from "@/components/ui/icons";
import { SafeImage } from "./safe-image";

/** First visible character of a name, upper-cased; "?" when there is none. */
export function initialOf(name: string | null | undefined): string {
  return Array.from((name ?? "").trim())[0]?.toLocaleUpperCase() ?? "?";
}

/**
 * Avatar that falls back to the owner's initial when there is no picture or the
 * picture cannot be loaded. The caller sizes it through `className`.
 */
export function MediaAvatar({
  src,
  name,
  alt = "",
  className,
  testId,
}: {
  src: string | null | undefined;
  name: string;
  alt?: string;
  className?: string;
  testId?: string;
}) {
  return (
    <SafeImage
      src={src}
      alt={alt}
      decoding="async"
      className={cn("h-full w-full object-cover", className)}
      data-testid={testId}
      fallback={
        <span
          aria-hidden="true"
          data-testid={testId ? `${testId}-fallback` : "media-avatar-fallback"}
          className={cn("grid h-full w-full place-items-center bg-surface-2 font-bold text-fg-muted", className)}
        >
          {initialOf(name)}
        </span>
      }
    />
  );
}

/** Cover photo that falls back to a neutral panel instead of a broken image. */
export function MediaCover({
  src,
  className,
  testId,
}: {
  src: string | null | undefined;
  className?: string;
  testId?: string;
}) {
  return (
    <SafeImage
      src={src}
      alt=""
      decoding="async"
      className={cn("h-full w-full object-cover", className)}
      fallback={<div aria-hidden="true" data-testid={testId ?? "media-cover-fallback"} className={cn("h-full w-full bg-surface-2", className)} />}
    />
  );
}

/** Organization logo with a building glyph fallback. */
export function MediaLogo({ src, alt = "", className }: { src: string | null | undefined; alt?: string; className?: string }) {
  return (
    <SafeImage
      src={src}
      alt={alt}
      decoding="async"
      className={cn("h-full w-full object-cover", className)}
      fallback={
        <span aria-hidden="true" data-testid="media-logo-fallback" className="grid h-full w-full place-items-center bg-surface-2 text-fg-muted">
          <BuildingIcon size={20} />
        </span>
      }
    />
  );
}

/** Small product thumbnail with a package glyph fallback. */
export function MediaThumb({ src, className }: { src: string | null | undefined; className?: string }) {
  return (
    <SafeImage
      src={src}
      alt=""
      width={44}
      height={44}
      loading="lazy"
      decoding="async"
      className={cn("h-full w-full object-cover", className)}
      fallback={<PackageIcon size={18} />}
    />
  );
}

/** Dashed empty state for sections that have no media yet. */
export function EmptyMedia({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId ?? "empty-media"} className="rounded-md border border-dashed bg-surface-2/40 p-md text-center text-body text-fg-muted">
      {children}
    </div>
  );
}
