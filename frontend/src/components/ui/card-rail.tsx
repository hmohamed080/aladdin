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

  /**
   * The travel distance the last arrow click COMMITTED to, or null when the rail
   * is wherever the user last left it.
   *
   * This is the whole fix for consecutive clicks, and it exists because a smooth
   * scroll is not instantaneous. Measuring geometry gives you where the rail IS,
   * and 150ms into an animation that is a moving, meaningless position: a second
   * click would look at cards drifting past mid-flight, find that the "next card
   * that starts after here" is the one already being scrolled to, and command a
   * move that finishes the FIRST click instead of advancing past it. Clicking
   * next three times quickly then advanced one card, not three — which reads as
   * an arrow that randomly ignores you.
   *
   * Holding the committed destination separately means every click reasons about
   * where the rail is HEADED, while the distance it actually commands is still
   * measured from live geometry (which is what `scrollBy` is relative to).
   */
  const commit = useRef<number | null>(null);

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
    // Arrived. Releasing the commitment here (rather than on a timer) means the
    // rail is never left believing it is mid-flight after it has settled.
    if (commit.current !== null && Math.abs(travelled - commit.current) <= 2) {
      commit.current = null;
    }
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    // Any scroll the USER drives — wheel, trackpad, swipe, drag, arrow keys —
    // supersedes whatever an arrow was heading for. Without this, a click
    // followed by a swipe would leave the next click reasoning from a
    // destination the user has already overridden.
    const release = () => {
      commit.current = null;
    };
    for (const type of ["wheel", "touchstart", "pointerdown", "keydown"] as const) {
      el.addEventListener(type, release, { passive: true });
    }
    // Catches BOTH the viewport resizing and the sidebar changing mode — either
    // one changes how many cards fit, and therefore whether arrows belong.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      for (const type of ["wheel", "touchstart", "pointerdown", "keydown"] as const) {
        el.removeEventListener(type, release);
      }
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [measure, children]);

  /**
   * ONE CARD PER CLICK — the arrow is a "next item", not a "next page".
   *
   * The previous implementation multiplied a card's width by how many fit and
   * scrolled that far, so on a wide desktop a single click on a four-up rail
   * jumped four cards — usually straight to the end. That is a pager. What a
   * user reaches for here is the mobile-swipe gesture: show me the next one.
   *
   * WHY GEOMETRY, NOT ARITHMETIC
   * Nothing below computes a distance from a width and a gap. It measures where
   * each card actually IS relative to the rail and scrolls to the adjacent one.
   * That survives everything arithmetic gets wrong: a mixed-width card, a
   * different `gap` from a caller, the 4px scroll padding, fractional layout,
   * and a browser mid-way through a smooth scroll.
   *
   * RTL falls out for free. `leadDistance` measures from the rail's LOGICAL
   * start edge — the left edge in English, the right edge in Arabic — so "the
   * first card that begins after where we are" means the same sentence in both,
   * and only the sign of the final `scrollBy` differs.
   */
  const leadDistance = (track: HTMLElement, card: HTMLElement, rtl: boolean) => {
    const t = track.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    return rtl ? t.right - c.right : c.left - t.left;
  };

  /**
   * The rail's own logical start inset. A card that is correctly snapped sits at
   * `scroll-padding-inline-start` from the scrollport edge, NOT at zero, so its
   * measured lead distance at rest is that padding rather than 0. Landing a card
   * at lead 0 instead would leave it 4px past its snap position, the browser
   * would snap it back, and the correction would compound into visible drift
   * over a run of clicks. Read rather than hardcoded so a caller that changes
   * the rail's padding does not silently break the arithmetic.
   */
  const startInset = (el: HTMLElement) => {
    const style = getComputedStyle(el);
    const scrollPad = parseFloat(style.scrollPaddingInlineStart);
    if (Number.isFinite(scrollPad)) return scrollPad;
    const pad = parseFloat(style.paddingInlineStart);
    return Number.isFinite(pad) ? pad : 0;
  };

  const step = (direction: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const rtl = dir === "rtl";
    const cards = Array.from(el.children) as HTMLElement[];
    if (cards.length === 0) return;

    const SLACK = 6;
    const inset = startInset(el);
    const live = Math.abs(el.scrollLeft);
    // How far ahead of the live position the rail is already headed. Zero unless
    // a previous click is still animating.
    const ahead = commit.current === null ? 0 : commit.current - live;

    // `lead` is measured from live geometry, because that is the frame `scrollBy`
    // works in. `fromTarget` re-bases the same numbers onto where the rail is
    // GOING, which is the frame the choice of "which card is next" belongs in.
    const lead = cards.map((c) => leadDistance(el, c, rtl) - inset);
    const fromTarget = lead.map((d) => d - ahead);

    // Ascending by construction, so "the next one" is the first card that starts
    // after the committed position, and "the previous one" is the last card that
    // starts before it — never two, never the end of the rail.
    const index =
      direction === 1
        ? fromTarget.findIndex((d) => d > SLACK)
        : fromTarget.findLastIndex((d) => d < -SLACK);
    // -1 means there is no adjacent card in that direction: we are at the end of
    // the rail, or already committed to it. Doing nothing is correct.
    const distance = index === -1 ? undefined : lead[index];
    if (distance === undefined) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({
      // In RTL the logical "forward" is a DECREASING scrollLeft, hence the flip.
      left: (rtl ? -1 : 1) * distance,
      behavior: reduce ? "auto" : "smooth",
    });
    commit.current = live + distance;
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
            onClick={() => step(-1)}
            disabled={atStart}
            aria-label={t("rail.previous")}
            data-testid="rail-prev"
            className={cn(arrow, "absolute start-0 top-1/2 -translate-y-1/2 -ms-1")}
          >
            <PrevIcon size={16} />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
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
