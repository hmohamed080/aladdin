"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/ui/cn";
import {
  DEFAULT_DASHBOARD_PERIOD,
  isValidCustomRange,
  type DashboardPeriodKey,
} from "@/lib/workspace/dashboard-period";
import { CalendarIcon, ChevronDownIcon, CheckIcon } from "@/components/ui/icons";
import { menuSurfaceClass } from "@/components/ui/menu";

const rowClass = (selected: boolean) =>
  cn(
    "flex w-full items-center gap-2 px-2.5 py-1.5 text-start text-body",
    "transition-colors focus-visible:outline-none",
    selected
      ? "bg-lapis/[0.06] font-medium text-fg hover:bg-lapis/10 focus-visible:bg-lapis/10"
      : "text-fg hover:bg-surface-hover focus-visible:bg-surface-hover",
  );

/**
 * The Showroom Owner dashboard's period control — the same custom-dropdown
 * shape and keyboard contract as the supply dashboard's `PeriodSelect`
 * (`menuitemradio` semantics, roving focus, Escape-to-close), extended with a
 * SIXTH option, "custom", that reveals an inline date-range sub-form instead
 * of navigating immediately.
 *
 * Not a shared component with `PeriodSelect`: the two vocabularies
 * (`PeriodKey` vs `DashboardPeriodKey`) differ, and folding "does this option
 * open a date-range form" into the older control would complicate a working
 * component to serve a page that does not use it. See
 * `lib/workspace/dashboard-period.ts` for why the vocabularies are separate.
 */
export function DashboardPeriodSelect({
  value,
  from,
  to,
  basePath,
  label,
  options,
  fromLabel,
  toLabel,
  applyLabel,
}: {
  value: DashboardPeriodKey;
  /** The active custom range, when `value === "custom"` — pre-fills the date inputs. */
  from?: string;
  to?: string;
  basePath: string;
  label: string;
  options: { value: DashboardPeriodKey; label: string }[];
  fromLabel: string;
  toLabel: string;
  applyLabel: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(from ?? "");
  const [customTo, setCustomTo] = useState(to ?? "");
  // Whether the custom From/To sub-form is showing. Distinct from `value`
  // itself: picking "Custom period" does not navigate (there is nothing to
  // apply yet), so it cannot be represented by the committed URL state — it
  // needs its own flag, reset to match the committed period every time the
  // menu opens fresh.
  const [showCustom, setShowCustom] = useState(value === "custom");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  const selectedIndex = Math.max(
    options.findIndex((o) => o.value === value),
    0,
  );
  const current = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
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

  useEffect(() => {
    if (open) items.current[selectedIndex]?.focus();
  }, [open, selectedIndex]);

  useEffect(() => {
    if (open) setShowCustom(value === "custom");
  }, [open, value]);

  const navigate = (next: DashboardPeriodKey, customRange?: { from: string; to: string }) => {
    const q = new URLSearchParams(params.toString());
    if (next === DEFAULT_DASHBOARD_PERIOD) {
      q.delete("period");
      q.delete("from");
      q.delete("to");
    } else {
      q.set("period", next);
      if (next === "custom" && customRange) {
        q.set("from", customRange.from);
        q.set("to", customRange.to);
      } else {
        q.delete("from");
        q.delete("to");
      }
    }
    const qs = q.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  };

  const choose = (next: DashboardPeriodKey) => {
    if (next === "custom") {
      // Stays open: the date inputs need the user's next action, unlike
      // every other option which is a complete choice on its own. Reveals
      // the From/To sub-form, which stays hidden for every other preset.
      setShowCustom(true);
      return;
    }
    setShowCustom(false);
    setOpen(false);
    trigger.current?.focus();
    navigate(next);
  };

  const applyCustom = () => {
    if (!isValidCustomRange(customFrom, customTo)) return;
    setOpen(false);
    trigger.current?.focus();
    navigate("custom", { from: customFrom, to: customTo });
  };

  const onItemKey = (e: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = options.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowDown") next = index === last ? 0 : index + 1;
    else if (e.key === "ArrowUp") next = index === 0 ? last : index - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    items.current[next]?.focus();
  };

  return (
    <div ref={root} className="relative inline-flex">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        data-testid="dashboard-period-select"
        className={cn(
          "relative inline-flex items-center gap-1.5 rounded-sm border bg-surface ps-2.5 pe-2 py-1.5 shadow-sm",
          "text-label font-medium text-fg transition-colors hover:bg-surface-hover",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
        )}
      >
        <span aria-hidden="true" className="shrink-0 text-fg-muted">
          <CalendarIcon size={15} />
        </span>
        <span className="min-w-0 truncate">{current?.label}</span>
        <span aria-hidden="true" className="shrink-0 text-fg-muted">
          <ChevronDownIcon size={14} />
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={label}
          data-testid="dashboard-period-menu"
          /* `end-0`, not `start-0`: the trigger sits at the FAR end of the
             dashboard's header row (a `justify-between` row with the period
             control last), so anchoring the panel's leading/`start` edge to
             the trigger let a `w-max` panel grow straight past the viewport's
             trailing edge in LTR. Anchoring the panel's OWN trailing edge to
             the trigger instead makes it grow back inward — toward the
             viewport, not away from it — in both LTR and RTL, since `end`
             flips with direction the same way `start` does. The width cap
             keeps the custom-range sub-form (two date fields) from doing the
             same thing sideways on a narrow phone viewport. */
          className={cn(
            menuSurfaceClass,
            "absolute end-0 top-full mt-1 z-popover min-w-full w-max max-w-[min(20rem,calc(100vw-2rem))]",
          )}
        >
          <ul className="flex flex-col py-0.5">
            {options.map((o, i) => {
              const selected = o.value === value || (o.value === "custom" && showCustom);
              return (
                <li key={o.value}>
                  <button
                    ref={(el) => {
                      items.current[i] = el;
                    }}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => choose(o.value)}
                    onKeyDown={(e) => onItemKey(e, i)}
                    data-testid={`dashboard-period-option-${o.value}`}
                    className={rowClass(selected)}
                  >
                    <span className="truncate">{o.label}</span>
                    {selected ? (
                      <CheckIcon size={14} className="ms-auto shrink-0 text-lapis" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>

          {/* The custom-range sub-form. Hidden for every preset except
              "Custom period" — a committed rolling/calendar preset has no use
              for From/To fields, and showing them anyway was the bug. */}
          {showCustom ? (
            <div className="border-t px-2.5 py-2">
              {/* Stacked below `tablet`, so two native date inputs never have to
                  fight a ~256px popover for width on a phone — side by side only
                  once there is room for both to stay comfortably usable. */}
              <div className="flex flex-col gap-1.5 tablet:flex-row tablet:items-center">
                <label className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[0.6875rem] text-fg-muted">{fromLabel}</span>
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    data-testid="dashboard-period-custom-from"
                    className="w-full rounded-sm border bg-surface px-2 py-1 text-label text-fg"
                  />
                </label>
                <label className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[0.6875rem] text-fg-muted">{toLabel}</span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    data-testid="dashboard-period-custom-to"
                    className="w-full rounded-sm border bg-surface px-2 py-1 text-label text-fg"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={applyCustom}
                disabled={!isValidCustomRange(customFrom, customTo)}
                data-testid="dashboard-period-custom-apply"
                className={cn(
                  "mt-1.5 w-full rounded-sm bg-accent-solid px-2.5 py-1.5 text-label font-medium text-on-accent",
                  "transition-colors hover:opacity-90 disabled:pointer-events-none disabled:opacity-50",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
                )}
              >
                {applyLabel}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
