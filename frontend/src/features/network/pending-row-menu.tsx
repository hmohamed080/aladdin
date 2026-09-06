"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/ui/cn";
import { MoreHorizontalIcon } from "@/components/ui/icons";
import { menuSurfaceClass, menuItemClass } from "@/components/ui/menu";
import { cancelNetworkReferral } from "@/server/actions/network-referrals";

/**
 * The compact overflow trigger for a pending row's one destructive action
 * (revisit §8: "move Withdraw out of the main row body into a compact
 * overflow/menu action"). Reuses the Foundation's own floating-menu surface
 * (`components/ui/menu.ts`) rather than inventing a new one — the same
 * primitive `BoardMenu` already builds its trigger from.
 */
export function PendingRowMenu({
  referralId,
  label,
  withdrawLabel,
}: {
  referralId: string;
  /** Accessible name for the trigger — what this menu is for. */
  label: string;
  withdrawLabel: string;
}) {
  const [open, setOpen] = useState(false);
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
          "grid h-7 w-7 shrink-0 place-items-center rounded-sm text-fg-muted transition-colors",
          "hover:bg-surface-hover hover:text-fg",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
        )}
      >
        <MoreHorizontalIcon size={16} />
      </button>

      {open ? (
        <div role="menu" aria-label={label} className={cn(menuSurfaceClass, "absolute end-0 top-full z-popover mt-1 w-40")}>
          <form action={cancelNetworkReferral}>
            <input type="hidden" name="referralId" value={referralId} />
            <button type="submit" role="menuitem" className={menuItemClass(false, "text-danger")}>
              <span className="truncate">{withdrawLabel}</span>
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
