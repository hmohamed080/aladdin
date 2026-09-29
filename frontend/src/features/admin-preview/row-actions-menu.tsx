"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/ui/cn";
import { MoreHorizontalIcon } from "@/components/ui/icons";
import { menuSurfaceClass, menuItemClass } from "@/components/ui/menu";
import { PreviewConfirmDialog } from "@/features/admin-preview/preview-action-dialog";

export type RowAction =
  | { kind: "link"; label: string; href: string }
  | {
      kind: "action";
      label: string;
      title: string;
      body?: string;
      confirmLabel: string;
      confirmVariant?: "danger" | "accent" | "primary";
      tone?: "danger";
    };

/**
 * Compact "More" overflow for a directory row — Phase 0B. A Users/Organizations
 * row lists up to ten possible actions (View/Verify/Reject/Suspend/Restore/
 * Activity/Points/View org/Add note/Audit); showing ten buttons per row is not
 * viable, so this collects them into one menu, reusing the Foundation's own
 * floating-menu surface (`components/ui/menu.ts`) the same way
 * `PendingRowMenu` does for the Network page.
 *
 * `kind: "link"` items are real navigation (into the detail page's tabs) —
 * never a fake mutation. `kind: "action"` items open the SAME preview-only
 * confirm dialog every other Phase 0 mutating-looking control uses
 * (`PreviewConfirmDialog`), one at a time, driven by this menu instead of a
 * dedicated trigger button per action.
 */
export function RowActionsMenu({ label, actions }: { label: string; actions: RowAction[] }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = activeIndex !== null ? actions[activeIndex] : null;

  return (
    <div ref={root} className="relative inline-flex">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-sm text-fg-muted transition-colors",
          "hover:bg-surface-hover hover:text-fg",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
        )}
      >
        <MoreHorizontalIcon size={16} />
      </button>

      {open ? (
        <div role="menu" aria-label={label} className={cn(menuSurfaceClass, "absolute end-0 top-full z-popover mt-1 w-48")}>
          {actions.map((a, i) =>
            a.kind === "link" ? (
              <Link key={a.label} href={a.href} role="menuitem" className={menuItemClass(false)} onClick={() => setOpen(false)}>
                <span className="truncate">{a.label}</span>
              </Link>
            ) : (
              <button
                key={a.label}
                type="button"
                role="menuitem"
                className={menuItemClass(false, a.tone === "danger" ? "text-danger" : undefined)}
                onClick={() => {
                  setOpen(false);
                  setActiveIndex(i);
                }}
              >
                <span className="truncate">{a.label}</span>
              </button>
            ),
          )}
        </div>
      ) : null}

      {active && active.kind === "action" ? (
        <PreviewConfirmDialog
          open={activeIndex !== null}
          onOpenChange={(next) => {
            if (!next) setActiveIndex(null);
          }}
          title={active.title}
          body={active.body}
          confirmLabel={active.confirmLabel}
          confirmVariant={active.confirmVariant}
        />
      ) : null}
    </div>
  );
}
