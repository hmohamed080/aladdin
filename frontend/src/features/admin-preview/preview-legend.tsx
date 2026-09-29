import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * Phase 0C — "real vs. Preview data must be visually honest" (explicit PO
 * instruction): a single, section-level note rather than a badge on every
 * fixture cell. Column headers for fixture-backed columns carry the small
 * `PREVIEW_MARK` suffix; this legend (rendered once per page/section) is
 * what that mark refers back to. Never render a per-cell badge for a
 * fixture value when this pattern applies — the noise itself would defeat
 * the "clearly but not noisily" instruction.
 */
export const PREVIEW_MARK = " •";

export function PreviewLegend({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-label text-fg-muted">
      <span aria-hidden="true" className="text-warning">
        •
      </span>
      {children}
    </p>
  );
}

/** Inline marker for a fixture-backed table cell that ALSO needs its own callout (rare — prefer the column-header mark + one legend). */
export function PreviewDot({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("text-warning", className)}>
      •
    </span>
  );
}
