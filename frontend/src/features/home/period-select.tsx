"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/ui/cn";
import type { PeriodKey } from "@/lib/workspace/period";
import { CalendarIcon, ChevronDownIcon } from "@/components/ui/icons";

/**
 * The dashboard's period scope — "last 30 days", and what it is measured
 * against.
 *
 * WHY A NATIVE `<select>` INSIDE A CHIP
 * The reference draws this as a small pill with a calendar glyph, and the
 * obvious way to build that is a button that opens a floating list. That would
 * be a listbox: roving focus, `aria-activedescendant`, type-ahead, escape
 * handling, portal, outside-click, and a scroll-lock — a few hundred lines to
 * reproduce, badly, a control every platform already ships. A native select
 * styled to look like the chip gets the keyboard behaviour, the screen-reader
 * semantics, the mobile wheel picker and the RTL mirroring for free, and the
 * only thing it costs is that the open list is drawn by the OS rather than by
 * us — which no one has ever complained about.
 *
 * `appearance-none` plus an absolutely-positioned glyph pair is the whole trick;
 * the select itself stays a real select and simply renders transparent over the
 * chip's own background.
 *
 * WHY IT WRITES TO THE URL
 * The dashboard is a server component and every figure on it is fetched on the
 * server inside RLS. Putting the period in the query string means changing it
 * refetches through the same guarded path, a chosen period survives a reload,
 * and "look at my last quarter" is a link someone can send to their partner.
 * The alternative — holding it in client state and filtering an array that was
 * already fetched — would need the page to ship every row it might ever need to
 * the browser, which is both slower and a data-exposure decision nobody made.
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

  return (
    <div
      className={cn(
        "relative inline-flex items-center gap-1.5 rounded-sm border bg-surface ps-2.5 pe-2 py-1.5 shadow-sm",
        "focus-within:ring-2 focus-within:ring-focus focus-within:ring-offset-1 focus-within:ring-offset-surface",
      )}
    >
      <span aria-hidden="true" className="shrink-0 text-iris">
        <CalendarIcon size={15} />
      </span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          // The default carries no parameter, so the plain dashboard URL stays
          // clean and a shared link only ever names a period deliberately chosen.
          if (e.target.value === "30d") next.delete("period");
          else next.set("period", e.target.value);
          const qs = next.toString();
          router.push(qs ? `${basePath}?${qs}` : basePath);
        }}
        className={cn(
          "min-w-0 appearance-none bg-transparent pe-4 text-label font-medium text-fg",
          "focus:outline-none",
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute end-2 flex items-center text-fg-muted"
      >
        <ChevronDownIcon size={14} />
      </span>
    </div>
  );
}
