"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/ui/cn";
import { MoreHorizontalIcon } from "@/components/ui/icons";
import { menuSurfaceClass, menuItemClass } from "@/components/ui/menu";

/**
 * A board's own overflow trigger — the compact three-dot control the
 * reference puts beside every header's filters.
 *
 * Real actions only, kept to two: refreshing the board (a genuine
 * `router.refresh()`, not a decorative spinner) and a way out to the module
 * that owns the board's full list, when the caller has one to give. Nothing
 * here is invented to fill the menu — a board with no "full list" route
 * (the reference modules further down the page) simply gets the one action
 * that is real everywhere: refresh.
 */
export function BoardMenu({
  label,
  refreshLabel,
  viewAllLabel,
  viewAllHref,
}: {
  /** Accessible name for the trigger — the board's own title works well. */
  label: string;
  refreshLabel: string;
  viewAllLabel?: string;
  viewAllHref?: string;
}) {
  const router = useRouter();
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
        <MoreHorizontalIcon size={17} />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={label}
          className={cn(menuSurfaceClass, "absolute end-0 top-full mt-1 z-popover w-44")}
        >
          <ul className="flex flex-col py-0.5">
            {viewAllHref && viewAllLabel ? (
              <li>
                <Link
                  href={viewAllHref}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className={menuItemClass(false)}
                >
                  <span className="truncate">{viewAllLabel}</span>
                </Link>
              </li>
            ) : null}
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  router.refresh();
                }}
                className={menuItemClass(false)}
              >
                <span className="truncate">{refreshLabel}</span>
              </button>
            </li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}
