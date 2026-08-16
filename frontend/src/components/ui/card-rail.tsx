"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";

/**
 * A horizontal card rail — one row of cards that scrolls sideways inside itself.
 *
 * WHAT IT IS FOR
 * Dense groups of PEER cards that would otherwise wrap into a tall grid and push
 * the real work below the fold: KPI tiles, entry-ramp actions, shortlist rows.
 * It is not a carousel and must not be used for tables, charts, forms, or the
 * long operational lists — those need scanning and comparison down the page, and
 * hiding half of a list behind a swipe is a regression, not a polish.
 *
 * RTL
 * `scrollLeft` is the one layout API that does NOT follow writing direction
 * cleanly: in an RTL container the resting position is 0 and scrolling toward
 * the logical end makes it NEGATIVE. Every read here goes through `Math.abs`, so
 * "distance travelled from the start" means the same thing in both directions,
 * and every write flips its sign from `dir`. Nothing in this file assumes that
 * left means previous.
 *
 * No dependency: `overflow-x: auto` already gives trackpad, wheel-shift, and
 * touch swipe for free. The buttons exist for mouse and keyboard users, and the
 * CSS scroll-snap keeps every stop on a card boundary.
 */
export function CardRail({
  label,
  children,
  /** Min width per card. The rail's whole point is that cards do NOT shrink. */
  itemWidth = "15rem",
  className,
}: {
  /** Accessible name for the scrollable region and its controls. */
  label: string;
  children: ReactNode;
  itemWidth?: string;
  className?: string;
}) {
  const { t, dir } = useI18n();
  const track = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  const [overflow, setOverflow] = useState(false);

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    // 2px of slack: fractional layout means scrollWidth, clientWidth and
    // scrollLeft rarely land on exactly equal integers even when the rail is
    // genuinely parked at an edge.
    const max = el.scrollWidth - el.clientWidth;
    const travelled = Math.abs(el.scrollLeft);
    setOverflow(max > 2);
    setAtStart(travelled <= 2);
    setAtEnd(travelled >= max - 2);
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    // Catches BOTH the viewport resizing and the sidebar changing mode — either
    // one changes how many cards fit, and therefore whether arrows belong.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [measure, children]);

  /** Move by whole cards — as many as currently fit, never a raw pixel guess. */
  const page = (direction: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const first = el.firstElementChild as HTMLElement | null;
    const gap = parseFloat(getComputedStyle(el).columnGap || "0") || 0;
    const step = first ? first.getBoundingClientRect().width + gap : el.clientWidth;
    const perView = Math.max(1, Math.floor(el.clientWidth / Math.max(step, 1)));
    const distance = step * perView;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({
      // In RTL the logical "next" is a DECREASING scrollLeft, hence the flip.
      left: (dir === "rtl" ? -1 : 1) * direction * distance,
      behavior: reduce ? "auto" : "smooth",
    });
  };

  const PrevIcon = dir === "rtl" ? ChevronRightIcon : ChevronLeftIcon;
  const NextIcon = dir === "rtl" ? ChevronLeftIcon : ChevronRightIcon;

  const arrow =
    "grid h-8 w-8 place-items-center rounded-pill border border-strong bg-surface text-fg-secondary shadow-card " +
    "transition-colors hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-0 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

  return (
    <div className={cn("relative", className)} data-testid="card-rail">
      <div
        ref={track}
        role="group"
        aria-label={label}
        // Focusable only when there is something to scroll, so a rail that fits
        // does not add a dead tab stop. When it does overflow, the region must be
        // reachable by keyboard alone (WCAG 2.1.1) — arrow keys then scroll it.
        tabIndex={overflow ? 0 : undefined}
        className={cn(
          "flex snap-x snap-mandatory gap-sm overflow-x-auto scroll-smooth",
          // Room for the shadow of raised cards, which `overflow` would clip.
          "-mx-1 px-1 py-1",
          // `scroll-px` MUST match that `px`, and it is not cosmetic. Scroll-snap
          // aligns a card's start edge to the scrollport's snap edge, which is
          // inset by scroll-padding — with padding but no scroll-padding the
          // first card snaps to `scrollLeft: 4`, the rail never reads as "at the
          // start", and the previous arrow stays enabled on a rail nobody has
          // scrolled yet.
          "scroll-px-1",
          // Cards hold their width instead of squeezing — that is what makes this
          // a rail rather than a grid that got narrower. `--rail-item` is set on
          // the track and inherits down, so callers tune one number.
          "[&>*]:min-w-[var(--rail-item)] [&>*]:shrink-0 [&>*]:snap-start",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          "motion-reduce:scroll-auto",
          // Older WebKit/Blink that predates `scrollbar-width` support.
          "[&::-webkit-scrollbar]:hidden",
        )}
        // The scrollbar is hidden, not merely thin. Windows Chrome paints a
        // CLASSIC (non-overlay) scrollbar, so `thin` left a permanent grey bar
        // under every rail — a horizontal rule the design system never asked
        // for, on a component whose whole job is to look like a row of cards.
        // Nothing is lost: the arrows appear whenever there is more to see, the
        // next card deliberately peeks, and the region is keyboard-scrollable.
        style={{ scrollbarWidth: "none", ["--rail-item" as string]: itemWidth }}
      >
        {children}
      </div>

      {/* Controls render only when the content genuinely overflows, so on a wide
          desktop where everything fits they are simply absent — not greyed out. */}
      {overflow ? (
        <>
          <button
            type="button"
            onClick={() => page(-1)}
            disabled={atStart}
            aria-label={t("rail.previous")}
            data-testid="rail-prev"
            className={cn(arrow, "absolute start-0 top-1/2 -translate-y-1/2 -ms-1")}
          >
            <PrevIcon size={16} />
          </button>
          <button
            type="button"
            onClick={() => page(1)}
            disabled={atEnd}
            aria-label={t("rail.next")}
            data-testid="rail-next"
            className={cn(arrow, "absolute end-0 top-1/2 -translate-y-1/2 -me-1")}
          >
            <NextIcon size={16} />
          </button>
        </>
      ) : null}
    </div>
  );
}
