"use client";

import Link from "next/link";
import { type ComponentType, type MouseEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import {
  navIconClass,
  navRowClass,
  NAV_ICON_HOVER_CLASS,
  NAV_ICON_SIZE,
} from "@/lib/ui/nav-geometry";

/**
 * THE ALADDIN NAVIGATION ITEM — one row, one visual language, every surface.
 *
 * This is the family the UI contract means by "navigation modes may vary; the
 * navigation language may not". A B2B workspace lists twenty capability-gated
 * modules and a personal account lists three destinations; those are different
 * INFORMATION ARCHITECTURES, and they are allowed to differ. What is not allowed
 * to differ is what a navigation row looks like, how it lights under a pointer,
 * how it reports that it is the current route, and where its glyph sits.
 *
 * It used to live inside `workspace-nav.tsx`, which made it structurally B2B
 * property: the personal surface could not reuse it without importing the module
 * registry, so it grew a horizontal rail with its own hover, its own active
 * treatment and its own icon geometry instead. Moving the row here is what lets
 * `Sidebar` (modules) and `PersonalSidebar` (destinations) be two lists in one
 * language rather than two navigations.
 *
 * The row is deliberately DUMB. It takes a resolved item and a resolved `active`
 * and paints them. It performs no matching, reads no route table and grants
 * nothing — every destination re-checks access server-side.
 */

/** One navigation destination, already resolved by whichever nav owns it. */
export type NavItem = {
  href: string;
  /** Translation key for the label. */
  key: string;
  exact: boolean;
  Icon: ComponentType<{ size?: number }>;
};

export function NavLink({
  item,
  active,
  narrow,
  carved,
  ground = "shell",
  openIndicator = false,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  narrow?: boolean;
  /**
   * Whether a carve is painted behind this row's active state.
   *
   * On the shell this is now ALWAYS true and the prop exists for the one ground
   * where it is not: the mobile "More" sheet, which is an ordinary light list
   * with no shell, no trailing edge and nothing to carve out of. It used to vary
   * across the DESKTOP modes too — docked carved, rail and hover reveal did not
   * — and that is the split this pass removed. One sidebar, one active mechanic,
   * at every width.
   */
  carved?: boolean;
  /**
   * Which material this row is painted on.
   *
   * The desktop rail stands on the navy shell; the mobile "More" sheet stands on
   * `surface`, the ordinary light content ground. They cannot share a palette —
   * `shell-fg-secondary` is a pale blue chosen to sit on navy, and on the sheet's
   * white it measures about 1.5:1. This prop is what keeps one component honest
   * on two grounds instead of quietly making one of them unreadable.
   */
  ground?: "shell" | "surface";
  /**
   * A persistent tile wash independent of hover/active — the "this is
   * currently open" cue for a collapsed-rail GROUP icon (see `Sidebar`'s
   * narrow branch). Distinct from `active`, which means "the current route is
   * here": a closed group can be active without being open, and an open one
   * can hold no active route at all.
   */
  openIndicator?: boolean;
  /**
   * Intercepts the click instead of navigating — the collapsed rail's group
   * icon uses this to toggle its own reveal rather than follow `item.href`
   * (which it still carries, so the icon and its `aria-label` stay a genuine,
   * working destination for anything that isn't a plain left-click: keyboard
   * Enter still activates this handler too, same as a normal click would).
   */
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const { href, key, Icon } = item;
  const label = t(key);

  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      aria-label={narrow ? label : undefined}
      /* The carve reads its target from HERE. It is a data attribute rather than
         a class because `ActiveCarve` observes attribute mutations to know when
         navigation happened, and a Tailwind class string is neither stable
         enough to query nor semantic enough to observe. */
      data-nav-active={active ? "true" : undefined}
      className={cn(
        "group relative z-10 flex items-center rounded-sm text-label font-medium",
        "transition-[background-color,color,box-shadow] duration-fast ease-standard motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1",
        ground === "shell" ? "focus-visible:ring-offset-shell" : "focus-visible:ring-offset-surface",
        navRowClass(Boolean(narrow)),
        // NO ROW EVER PAINTS ITS OWN ACTIVE BACKGROUND ON THE SHELL. The active
        // surface is the carve — one element behind the whole list that moves
        // between rows and re-proportions with the panel (see nav-carve.tsx) —
        // so a background here would draw a second, square surface inside the
        // carved one and defeat the effect. That is now true at RAIL width too,
        // where this row used to paint an accent-tinted tile of its own.
        // The row still owns its own HOVER, which the carve deliberately does
        // not: hover is a pointer state on one row, not a change of page.
        //
        // Foregrounds are shell tokens: this row sits on the ink shell, and the
        // Quartz-tuned `fg-secondary` is a warm grey that reads as dirty on it.
        // The light content ground (the mobile sheet). Unchanged from what this
        // row has always been there: a surface highlight for the current page,
        // a softer one on hover.
        !narrow &&
          ground === "surface" &&
          (active ? "bg-surface-2 text-fg" : "text-fg-secondary hover:bg-surface-hover hover:text-fg"),
        !narrow &&
          ground === "shell" &&
          (active
            ? // The row's ground is the carve's light surface, so it needs ink,
              // not a background of its own.
              "text-shell-active-fg"
            : "text-shell-fg-secondary hover:bg-shell-2 hover:text-shell-fg"),
      )}
    >
      {/* THE 2px ACCENT MARKER IS GONE FROM THE SHELL ENTIRELY.
          It survived on the collapsed rail on the reasoning that the rail had no
          carve and no label, so the bar was the only cue there was. The rail has
          a carve now — the same one, at tile scale — and a stray accent rule
          laid across a light pill reads as a rendering artefact rather than as
          emphasis, exactly as it did on the expanded band. It stays only on the
          mobile sheet, which genuinely has no carve. */}
      {!carved ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-1.5 start-0 w-0.5 rounded-pill bg-accent-solid transition-opacity",
            active ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}
      <span
        /* A stable hook for the icon tile. Tests used to find it as "the second
           span in the row", which was only ever true while the active marker
           before it rendered unconditionally; now that the marker is rail-only,
           position is not identity. */
        data-nav-icon="true"
        className={cn(
          // The icon's BOX is the same 36px tile in every mode — that is geometry,
          // and it is what keeps this glyph on the same centre line as the mode
          // control at the foot of the panel, which needs a tile of its own.
          navIconClass(),
          // The tile only PAINTS on the collapsed rail, where the row is 40px of
          // icon and the tile effectively IS the row. A wide row highlights as a
          // ROW — see the `!narrow` hover on the link above — and lighting a tile
          // inside an already-highlighted row would draw a second, smaller box
          // around the icon and split one target into two.
          //
          // AN ACTIVE RAIL ICON NO LONGER PAINTS ANYTHING. It used to carry
          // `bg-accent-solid/15`, which was the rail's stand-in for a carve back
          // when the rail had none. It has one now — the same element, at tile
          // scale, sitting exactly here — so a tint on this span would be a
          // second surface inside the first.
          !active && narrow && NAV_ICON_HOVER_CLASS,
          // The collapsed rail's own "this group is open" cue — independent
          // of `active`/`carved`, which answer "is the current route here",
          // not "did the reader open this". A closed static wash rather than
          // a chevron: this tile has no room for a second glyph, and the
          // reveal underneath it is already the loudest possible "it's open".
          openIndicator && !active && "bg-shell-2",
          // One ground, one foreground: an active glyph sits on the carve's
          // light surface in EVERY mode now, so it takes the carve's ink in
          // every mode. This used to fork three ways — carve ink when docked,
          // Lumen on the rail's accent tile, Lumen again in the hover reveal —
          // which is the same "three answers to one question" the carve itself
          // had, one element in.
          ground === "surface" && (active ? "text-accent" : "text-fg-muted group-hover:text-fg"),
          ground === "shell" && active && carved && "text-shell-active-fg",
          // `accent-solid` (Lumen itself), never `accent`. The AA-safe `accent`
          // is a DARK gold tuned for type on a light page — 2.1:1 on the shell,
          // an invisible glyph. Lumen clears 9:1 on this ground. Reached only on
          // a ground that has no carve, which on the shell is nothing and on the
          // mobile sheet is every active row.
          ground === "shell" && active && !carved && "text-accent-solid",
          ground === "shell" && !active && "text-shell-fg-secondary group-hover:text-shell-fg",
        )}
      >
        <Icon size={NAV_ICON_SIZE} />
      </span>
      {/* THE LABEL REVEAL. Mounted only when there is width for it — the rail
          asserts `link.textContent === ""`, and an accessible name that is
          sometimes the aria-label and sometimes a clipped span is two contracts
          — but its ARRIVAL is animated, because the panel takes ~240ms to widen
          and text appearing instantly at the start of that reads as a pop rather
          than as a reveal.

          Opacity alone, deliberately. An `x` offset would be physical and would
          slide the wrong way in Arabic, and the movement is already supplied by
          the panel opening underneath it. */}
      {narrow ? null : (
        <motion.span
          className="truncate"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reduced ? 0 : 0.22, ease: "easeOut" }}
        >
          {label}
        </motion.span>
      )}
    </Link>
  );
}
