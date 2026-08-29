"use client";

import { cn } from "@/lib/ui/cn";

/**
 * The "Latest activity" board's footer action.
 *
 * NOT A LINK, ON PURPOSE. Every other board's footer goes to the module that
 * owns its full list — but there is no `/b2b/notifications` route in this
 * product; the complete list already lives in the header's own notification
 * panel (`header-panels.tsx`, `data-testid="header-notifications"`). Rather
 * than invent a new page and a new list view to give this one footer
 * somewhere to point, the footer opens the SAME panel the bell icon does —
 * real behaviour, zero new routes or backend.
 *
 * Same shape as `BoardOut` (`supply-boards.tsx`) so the five footers read as
 * one family; only the element and the action differ.
 */
export function ViewActivityAction({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        const bell = document.querySelector<HTMLElement>('[data-testid="header-notifications"]');
        bell?.click();
      }}
      className={cn(
        "group flex w-full items-center gap-2 text-start text-label font-semibold text-fg transition-colors hover:text-info",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
      )}
    >
      <span className="truncate">{label}</span>
      <span
        aria-hidden="true"
        className="ms-auto shrink-0 text-fg-muted transition-colors group-hover:text-info"
      >
        <span className="inline-block rtl:-scale-x-100">→</span>
      </span>
    </button>
  );
}
