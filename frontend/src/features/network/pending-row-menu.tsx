"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/ui/cn";
import { MoreHorizontalIcon } from "@/components/ui/icons";
import { FloatingMenu } from "@/components/ui/floating-menu";
import { menuItemClass } from "@/components/ui/menu";
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
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative inline-flex">
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

      <FloatingMenu
          open={open}
          onClose={() => setOpen(false)}
          anchorRef={trigger}
          role="menu"
          aria-label={label}
          placement="bottom-end"
          className="w-40"
        >
          <form action={cancelNetworkReferral}>
            <input type="hidden" name="referralId" value={referralId} />
            <button type="submit" role="menuitem" className={menuItemClass(false, "text-danger")}>
              <span className="truncate">{withdrawLabel}</span>
            </button>
          </form>
        </FloatingMenu>
    </div>
  );
}
