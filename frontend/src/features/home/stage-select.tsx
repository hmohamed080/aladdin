"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/ui/cn";
import { ChevronDownIcon, CheckIcon } from "@/components/ui/icons";
import { menuSurfaceClass, menuItemClass } from "@/components/ui/menu";
import type { AttentionKind } from "@/features/home/supply-attention";

/**
 * The attention board's compact header filter — the reference's "All types"
 * control, alongside (not instead of) the chip row underneath the header.
 *
 * Both read and write the SAME `stage` query state the chips do — this is a
 * second, compact shape for the identical choice, not a second dimension of
 * filtering invented to fill the header. Its rows are real `<Link>`s for the
 * same reason `AttentionFilter`'s chips are (see that file): a stage change
 * is a server navigation behind several queries, and a client router push
 * would only hide that latency, not remove it.
 */
export function StageSelect({
  value,
  basePath,
  label,
  allLabel,
  options,
  query,
}: {
  value: AttentionKind | null;
  basePath: string;
  label: string;
  allLabel: string;
  options: { key: AttentionKind; label: string }[];
  query?: Record<string, string>;
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

  const href = (stage: AttentionKind | null) => {
    const params = new URLSearchParams(query);
    if (stage) params.set("stage", stage);
    else params.delete("stage");
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const current = value ? (options.find((o) => o.key === value)?.label ?? allLabel) : allLabel;

  return (
    <div ref={root} className="relative inline-flex">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        data-testid="attention-type-select"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-sm border border-workspace-line bg-surface px-2.5 py-1.5",
          "text-label font-medium text-fg-secondary shadow-sm transition-colors hover:bg-surface-hover",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
        )}
      >
        <span className="min-w-0 max-w-24 truncate">{current}</span>
        <ChevronDownIcon size={14} className="shrink-0 text-fg-muted" />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={label}
          data-testid="attention-type-menu"
          className={cn(menuSurfaceClass, "absolute end-0 top-full mt-1 z-popover min-w-full w-max")}
        >
          <ul className="flex flex-col py-0.5">
            <li>
              <Link
                href={href(null)}
                role="menuitemradio"
                aria-checked={value === null}
                onClick={() => setOpen(false)}
                className={menuItemClass(value === null)}
              >
                <span className="truncate">{allLabel}</span>
                {value === null ? <CheckIcon size={14} className="ms-auto shrink-0 text-lapis" /> : null}
              </Link>
            </li>
            {options.map((o) => {
              const selected = value === o.key;
              return (
                <li key={o.key}>
                  <Link
                    href={href(o.key)}
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => setOpen(false)}
                    className={menuItemClass(selected)}
                  >
                    <span className="truncate">{o.label}</span>
                    {selected ? <CheckIcon size={14} className="ms-auto shrink-0 text-lapis" /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
