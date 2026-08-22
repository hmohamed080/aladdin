"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/ui/cn";
import type { PeriodKey } from "@/lib/workspace/period";
import { CalendarIcon, ChevronDownIcon, CheckIcon } from "@/components/ui/icons";
import { menuSurfaceClass } from "@/components/ui/menu";

/**
 * This menu's rows are deliberately NOT `menuItemClass`.
 *
 * The shared row is built for the shell's navigation menus — 12px inset, 8px
 * rhythm, and an amber wash on the current entry, which is right when the thing
 * selected is a PLACE you are in. This list is four scalar options on a data
 * panel: it wants a tighter row, and its selection is a value rather than a
 * location, so it reads better as a clean neutral fill with the blue carrying
 * the emphasis. Amber also has a job on this dashboard already.
 *
 * Written out rather than passed as options to the shared helper because `cn`
 * here is a plain string joiner, not `tailwind-merge` — appending `px-2.5` after
 * `px-3` emits BOTH, and Tailwind's own sort order decides the winner, which for
 * that pair is the one being overridden. An override that silently loses is
 * worse than an honest local recipe.
 */
const periodRowClass = (selected: boolean) =>
  cn(
    "flex w-full items-center gap-2 px-2.5 py-1.5 text-start text-body",
    "transition-colors focus-visible:outline-none",
    selected
      // The label stays in the ordinary foreground: at 13px a coloured label
      // reads as a LINK, and nothing in this list navigates. Blue appears once,
      // on the check, where it marks the answer without restating it. The ground
      // is a whisper of the same blue — enough to find the row when scanning,
      // not enough to be a second highlight.
      //
      // Hover still DEEPENS rather than falling back to the neutral hover, which
      // would repaint the chosen row as merely pointed-at.
      ? "bg-lapis/[0.06] font-medium text-fg hover:bg-lapis/10 focus-visible:bg-lapis/10"
      : "text-fg hover:bg-surface-hover focus-visible:bg-surface-hover",
  );

/**
 * The dashboard's period scope — "last 30 days", and what it is measured against.
 *
 * WHY THIS IS NO LONGER A NATIVE `<select>`
 * It was one, on the argument that a native control ships keyboard behaviour,
 * screen-reader semantics and RTL mirroring for free and costs only that the OS
 * draws the open list. That argument was right about behaviour and wrong about
 * appearance: the OS list was the one surface in the authenticated product that
 * looked like a browser rather than like Aladdin, and on a dashboard where every
 * other floating surface is `menuSurfaceClass` it read as a control borrowed from
 * another application.
 *
 * So the behaviour the native control was providing is now provided HERE, not
 * dropped: arrow-key traversal with roving focus, Home/End, Escape-to-close with
 * focus returned to the trigger, outside-click dismissal, and `menuitemradio`
 * semantics so assistive tech announces a set of mutually exclusive choices with
 * exactly one checked — which is what this is. That is the price of a custom
 * surface, and a custom dropdown that skips it is strictly worse than the native
 * select it replaced.
 *
 * WHY IT WRITES TO THE URL — unchanged
 * The dashboard is a server component and every figure on it is fetched on the
 * server inside RLS. Putting the period in the query string means changing it
 * refetches through the same guarded path, a chosen period survives a reload,
 * and "look at my last quarter" is a link someone can send to their partner.
 */
export function PeriodSelect({
  value,
  basePath,
  label,
  options,
}: {
  value: PeriodKey;
  /** Where the change lands — the dashboard's own route. */
  basePath: string;
  /** Accessible name; the chip shows only the chosen value, as the reference does. */
  label: string;
  options: { value: PeriodKey; label: string }[];
}) {
  const router = useRouter();
  /* The live query, so that changing the period PRESERVES everything else in it
     — the queue's stage filter above all. Reading it here rather than taking it
     as a prop keeps the rule in one place: whatever else the URL is carrying,
     this control only ever edits `period` and leaves the rest alone. */
  const params = useSearchParams();

  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  const selectedIndex = Math.max(
    options.findIndex((o) => o.value === value),
    0,
  );
  const current = options[selectedIndex];

  /* Dismiss on outside click / Escape — the same rule every other menu in the
     shell follows. Escape also RESTORES FOCUS, which the others can leave to the
     browser but this one cannot: focus is sitting on a menu item that is about to
     unmount, and dropping it sends the user back to the top of the document. */
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

  /* Opening lands focus on the CHOSEN row rather than the first one — what a
     native select does, and the reason arrowing through an open list starts from
     where you already are. */
  useEffect(() => {
    if (open) items.current[selectedIndex]?.focus();
  }, [open, selectedIndex]);

  const choose = (next: PeriodKey) => {
    setOpen(false);
    trigger.current?.focus();
    const q = new URLSearchParams(params.toString());
    // The default carries no parameter, so the plain dashboard URL stays clean
    // and a shared link only ever names a period deliberately chosen.
    if (next === "30d") q.delete("period");
    else q.set("period", next);
    const qs = q.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  };

  /** Roving focus across the rows. Arrows wrap; Home/End jump to the ends. */
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
          // Arrow keys open and step in, which is what this control did as a
          // native select and what every other dropdown in the product does.
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        data-testid="period-select"
        className={cn(
          // Chip geometry unchanged from the native version — same border, ground,
          // radius, elevation and inset — so the toolbar it sits in does not move
          // by a pixel. Only the open list changed.
          "relative inline-flex items-center gap-1.5 rounded-sm border bg-surface ps-2.5 pe-2 py-1.5 shadow-sm",
          "text-label font-medium text-fg transition-colors hover:bg-surface-hover",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
        )}
      >
        {/* Muted. A glyph inside a form control is chrome — it says "this is a
            date control", which the label beside it already says. */}
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
          data-testid="period-menu"
          // `start-0`: the list hangs from the LEADING edge of the chip, which is
          // the right edge in Arabic. The viewport cap rides along inside
          // `menuSurfaceClass`, so a narrow phone cannot push it off-screen.
          /* `min-w-full` measures the WRAPPER, which shrink-wraps the chip — so
             the list is never narrower than the trigger it hangs from, and reads
             as attached to it rather than as a panel that happens to be nearby.
             `w-max` lets a longer label push it wider; the viewport cap inside
             `menuSurfaceClass` stops that at the screen edge. */
          className={cn(menuSurfaceClass, "absolute start-0 top-full mt-1 z-popover min-w-full w-max")}
        >
          <ul className="flex flex-col py-0.5">
            {options.map((o, i) => {
              const selected = o.value === value;
              return (
                <li key={o.value}>
                  <button
                    ref={(el) => {
                      items.current[i] = el;
                    }}
                    type="button"
                    /* `menuitemradio`, not `menuitem`: these are mutually
                       exclusive and exactly one is in force, which is precisely
                       what the radio role means. Plain `menuitem` would announce
                       four unrelated commands and never say which is active. */
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => choose(o.value)}
                    onKeyDown={(e) => onItemKey(e, i)}
                    data-testid={`period-option-${o.value}`}
                    className={periodRowClass(selected)}
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
        </div>
      ) : null}
    </div>
  );
}
