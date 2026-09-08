"use client";

import { useId, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/ui/cn";
import { ChevronDownIcon } from "@/components/ui/icons";

/**
 * The show-more/show-less primitive — none existed in this codebase before
 * the Showroom Owner dashboard's KPI grid needed one. The closest precedents
 * were a one-way "show more" (no collapse back) in the B2C network directory,
 * and the sidebar's own `0fr↔1fr` grid-rows technique for a collapsible
 * GROUP. This generalizes that second technique into a reusable component,
 * because the KPI grid is not the last place on this dashboard that will
 * need "more, without a second page": product discovery reuses it too.
 *
 * `inert` while collapsed removes the hidden content from the tab order and
 * the accessibility tree at once — a `0fr` track plus `overflow: hidden`
 * only hides it VISUALLY, and a screen reader or keyboard user would
 * otherwise walk through tiles nobody can see. `aria-expanded` on the
 * trigger and `aria-controls` pointing at the region are what let assistive
 * tech announce the relationship; a plain click handler with no aria wiring
 * would announce a button that does nothing.
 */
export function ExpandCollapse({
  children,
  moreLabel,
  lessLabel,
  className,
}: {
  /** The content revealed when expanded — collapsed by default. */
  children: ReactNode;
  moreLabel: string;
  lessLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();
  const regionId = useId();

  return (
    <div className={className}>
      <div
        id={regionId}
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: reduced ? undefined : "grid-template-rows 220ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <motion.div
          className="overflow-hidden"
          inert={!open}
          initial={false}
          animate={{ opacity: open ? 1 : 0 }}
          transition={{ duration: reduced ? 0 : 0.18, ease: "easeOut" }}
        >
          {/* A top gap on the revealed content, not a bottom gap on the
              trigger row above — so nothing shifts when collapsed. */}
          <div className="pt-md">{children}</div>
        </motion.div>
      </div>

      <div className="mt-md flex justify-center">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={regionId}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-label font-medium text-accent",
            "transition-colors hover:bg-surface-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-canvas",
          )}
        >
          <span>{open ? lessLabel : moreLabel}</span>
          <ChevronDownIcon
            size={14}
            className={cn("transition-transform", open ? "rotate-180" : undefined)}
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  );
}
