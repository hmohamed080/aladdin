"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { menuItemClass, menuSurfaceClass } from "@/components/ui/menu";
import {
  SIDEBAR_MODE_COOKIE,
  SIDEBAR_MODES,
  SIDEBAR_WIDTH,
  sidebarModeLabelKey,
  type SidebarMode,
} from "@/lib/ui/sidebar-mode";
import { navColumnClass, navIconClass, navRowClass, NAV_ICON_SIZE } from "@/lib/ui/nav-geometry";
import { Sidebar } from "@/components/layout/workspace-nav";
import { Brand } from "@/components/layout/brand";
import { ShellAtmosphere } from "@/components/layout/shell-atmosphere";
import { CheckIcon, PanelIcon, SettingsIcon, TrendingUpIcon } from "@/components/ui/icons";
import type { CommerceStance } from "@/lib/workspace/supply-side";

const ONE_YEAR = 60 * 60 * 24 * 365;
const MENU_HOVER_DELAY_MS = 350;

/**
 * DESIGN-LAB ONLY: the top display-mode control.
 *
 * TWO SEPARATE GESTURES, ONE ELEMENT — a click and a hover mean different
 * things here, which the shared shell's version does not attempt: there a
 * click opens the same 3-option menu every time. Bitrix24 (and most rails
 * that put this control up top) split it: a click is the ONE choice you make
 * most often — flip between expanded and collapsed — and a hover is for the
 * rarer, deliberate choice of a specific mode, "Expand on hover" included.
 * Collapsing that into one menu-behind-a-click means the common case now
 * costs two clicks (open the menu, then pick the state you're already
 * looking at).
 *
 * A real component rather than a closure returning JSX (the shared shell's
 * `modeControl` helper) BECAUSE it owns hover-timer state: a plain function
 * invoked mid-render cannot call `useState`/`useRef` — only an actual
 * component, mounted as a real element, can.
 */
function SidebarModeControl({
  mode,
  menuAlign,
  onPick,
  ariaLabel,
}: {
  mode: SidebarMode;
  /** Which side of the trigger the menu opens toward — see the caller. */
  menuAlign: "up" | "down";
  onPick: (next: SidebarMode) => void;
  ariaLabel: string;
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; insetInlineStart: number } | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const clearOpenTimer = () => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  };
  const clearCloseTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  // A SHORT DELAY ON OPEN. Closing used to be immediate, which worked while
  // the trigger and the menu were one DOM subtree — a pointer leaving the
  // trigger for the menu never left THAT subtree, so there was nothing to
  // debounce. The menu is portaled now (see below), so the trip from trigger
  // to menu crosses a real gap in the DOM, and closing on the trigger's own
  // `mouseleave` would slam the menu shut mid-crossing. A short close delay,
  // cancelled by either surface's `mouseenter`, is what makes "hover the
  // trigger, then move into the menu" survive the portal.
  const scheduleOpen = () => {
    clearCloseTimer();
    clearOpenTimer();
    openTimer.current = setTimeout(() => setMenuOpen(true), MENU_HOVER_DELAY_MS);
  };
  const scheduleClose = () => {
    clearOpenTimer();
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setMenuOpen(false), 140);
  };
  const closeNow = () => {
    clearOpenTimer();
    clearCloseTimer();
    setMenuOpen(false);
  };

  useEffect(
    () => () => {
      clearOpenTimer();
      clearCloseTimer();
    },
    [],
  );

  /**
   * WHERE THE MENU RENDERS.
   *
   * Measured from the trigger, not assumed, because the trigger itself moves —
   * this control travels between the centre of a collapsed rail and the
   * leading edge of an expanded panel on the same spring the sidebar animates
   * with. `insetInlineStart` is computed by hand rather than left to CSS
   * logical properties, because the portal lands in `document.body`, outside
   * this component's own directional context; `getComputedStyle` on the root
   * is what tells it which physical edge "start" actually is right now.
   */
  useEffect(() => {
    if (!menuOpen || !trigger.current) return;
    const place = () => {
      if (!trigger.current) return;
      const rect = trigger.current.getBoundingClientRect();
      const rtl = getComputedStyle(document.documentElement).direction === "rtl";
      setMenuPos({
        top: menuAlign === "up" ? rect.top - 4 : rect.bottom + 4,
        insetInlineStart: rtl ? window.innerWidth - rect.right : rect.left,
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [menuOpen, menuAlign]);

  // Outside-click and Escape now have to check TWO disjoint DOM subtrees —
  // the trigger and the portaled menu no longer share one.
  useEffect(() => {
    if (!menuOpen) return;
    const inside = (node: Node | null) =>
      Boolean(trigger.current?.contains(node)) || Boolean(menuRef.current?.contains(node));
    const onPointer = (e: MouseEvent) => {
      if (!inside(e.target as Node)) closeNow();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeNow();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => {
          clearOpenTimer();
          clearCloseTimer();
          setMenuOpen(false);
          // THE CLICK IS A BINARY TOGGLE, NOT "OPEN THE MENU". Anything other
          // than "expanded" collapses to the rail — including `hover`, so
          // clicking mid-reveal lands on the plain collapsed state rather
          // than back on the hover mode that was already showing this.
          onPick(mode === "expanded" ? "collapsed" : "expanded");
        }}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        onFocus={() => {
          clearCloseTimer();
          setMenuOpen(true);
        }}
        onBlur={(e) => {
          const related = e.relatedTarget as Node | null;
          if (!trigger.current?.contains(related) && !menuRef.current?.contains(related)) closeNow();
        }}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={ariaLabel}
        data-testid="sidebar-control"
        className={cn(
          navIconClass(),
          "hover:bg-shell-2 focus-visible:bg-shell-2",
          "text-shell-fg-muted hover:text-shell-fg",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-shell",
        )}
      >
        <PanelIcon size={NAV_ICON_SIZE} />
      </button>

      {/* RENDERED THROUGH A PORTAL, STRAIGHT TO `document.body`.
          Anchored inside the panel, this menu inherited every ancestor's
          stacking context on the way up — including the scrolling nav list,
          which sits LATER in the DOM than the brand/control row and paints
          over it at equal z-index the moment the menu's own height overlaps
          that list's box. A `z-popover` on the menu itself cannot fix that:
          it only wins against SIBLINGS inside its own stacking context, and
          the nav list was never a sibling of the menu, only of an ancestor
          several levels up. Escaping to `document.body` removes every one of
          those ancestors at once, so the only stacking question left is
          "does 9999 beat the rest of the page", which it does by construction. */}
      {menuOpen && menuPos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              data-testid="sidebar-menu"
              onMouseEnter={clearCloseTimer}
              onMouseLeave={scheduleClose}
              className={cn(menuSurfaceClass, "fixed w-56")}
              style={{
                top: menuPos.top,
                insetInlineStart: menuPos.insetInlineStart,
                transform: menuAlign === "up" ? "translateY(-100%)" : undefined,
                zIndex: 9999,
              }}
            >
              <ul className="flex flex-col py-0.5">
                {SIDEBAR_MODES.map((value) => {
                  const selected = value === mode;
                  return (
                    <li key={value}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          closeNow();
                          onPick(value);
                        }}
                        aria-current={selected ? "true" : undefined}
                        data-testid={`sidebar-mode-${value}`}
                        className={menuItemClass(selected)}
                      >
                        <span className="truncate">{t(sidebarModeLabelKey(value))}</span>
                        {selected ? <CheckIcon size={16} className="ms-auto shrink-0 text-accent" /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/**
 * The desktop/tablet workspace sidebar and its three display modes.
 *
 * ONE SIDEBAR. NOT A RAIL PLUS A PANEL.
 * Every mode is this same component at a different width, and — since this pass
 * — with the same active mechanic, the same ground, the same brand mark and the
 * same geometry. That sounds like a description rather than a decision, so here
 * is what it replaced: a collapsed rail whose active item was an accent tile
 * with a marker bar, an expanded panel whose active item was a carved band, and
 * a hover reveal that was a third thing again — a translucent accent wash on a
 * shadowed floating surface with a 40px strip of nothing travelling beside it.
 * Three designs sharing a list of hrefs. Collapsing the sidebar did not narrow
 * an object; it swapped one out.
 *
 * WHY TWO NESTED BOXES
 * The outer box is a SPACER: it is the flex child that reserves horizontal room
 * in the shell, and its width is the RESTING width of the chosen mode. The inner
 * panel is absolutely positioned and carries the VISUAL width. In expanded and
 * collapsed modes the two agree and nothing moves. In expand-on-hover they
 * deliberately disagree: the panel grows to 15rem while the spacer stays at
 * 3.5rem, so the reveal opens inward over the page instead of reflowing it.
 * Widening a flex child on hover would relayout the entire document on every
 * pointer pass — that is the "continuously resizing/shifting the body" the brief
 * rules out, and it is also where the flicker comes from.
 *
 * OPENING OVER THE PAGE IS NOT THE SAME AS BEING A SEPARATE PANEL, and the
 * difference is where the previous version went wrong. The depth cue used to be
 * a `shadow-lg` on THIS box — which is the shell plus its 40px gutter — so a
 * reveal painted a shadowed rectangle 40px wider than any material, and the
 * empty strip read as a second floating surface stuck to the sidebar's side.
 * The shadow belongs to the PLATE, which is the only part of this box that is
 * actually a surface. See the plate below.
 *
 * Because the panel is `start-0` inside the spacer, the overflow direction is
 * derived from writing direction for free: it grows rightward in English and
 * leftward in Arabic, in both cases inward toward the content.
 *
 * Mobile is untouched — this whole subtree is `tablet:` only, and `MobileNav`
 * still owns the phone experience.
 */
export function SidebarShell({
  allowed,
  mode: initialMode,
  stance = "buyer",
  appName,
  orgName,
  branchName,
  designLabAtmosphere = false,
}: {
  allowed: readonly string[];
  mode: SidebarMode;
  /**
   * The product name, for the lockup at the head of the panel.
   *
   * The brand lives HERE now and not in the header. It moved because the header
   * stopped spanning the viewport: a lockup inside a card that begins 280px in
   * is no longer introducing the application, it is decorating one of two cards.
   * At the top of the full-height sidebar it is the first thing on the screen
   * again, which is the job it was always doing.
   */
  appName: string;
  /** The active organization, for the card at the foot of the panel. */
  orgName: string;
  /**
   * The active branch, or null when the caller's scope is org-wide. Null is a
   * real state and is drawn as absence — the card simply carries one line — not
   * as an em dash standing in for a place.
   */
  branchName: string | null;
  /**
   * Which seat this workspace leads from. It reaches only as far as `Sidebar`,
   * which uses it to order and label the modules. Every display mode, the hover
   * reveal, the RTL geometry and the mode cookie are stance-independent — this is
   * ONE sidebar serving every B2B organization, not a Showroom one and a
   * Distributor one.
   */
  stance?: CommerceStance;
  /** DESIGN-LAB PROTOTYPE GATE — see `app/b2b/layout.tsx`. One account only. */
  designLabAtmosphere?: boolean;
}) {
  const { t, locale } = useI18n();
  const reduced = useReducedMotion();
  const [mode, setMode] = useState<SidebarMode>(initialMode);
  const [revealed, setRevealed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  // A hover reveal must survive the trip to its own control menu — collapsing the
  // panel out from under an open menu would close it mid-choice.
  const open = mode === "expanded" || ((revealed || menuOpen) && mode === "hover");
  const narrow = !open;
  const resting = mode === "expanded" ? SIDEBAR_WIDTH.expanded : SIDEBAR_WIDTH.rail;
  const visual = open ? SIDEBAR_WIDTH.expanded : SIDEBAR_WIDTH.rail;

  const choose = (next: SidebarMode) => {
    setMode(next);
    setMenuOpen(false);
    setRevealed(false);
    // Written straight to `document.cookie` rather than through a server action:
    // this preference changes nothing the server computes except a width, so a
    // `revalidatePath` round trip would re-render the whole route to move a
    // border. The cookie is only read on the NEXT document request, where it
    // spares that load the flash. Local to this browser; nothing is persisted
    // server-side.
    document.cookie = `${SIDEBAR_MODE_COOKIE}=${next}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const hoverMode = mode === "hover";

  /**
   * THE MODE CONTROL IS ICON-ONLY. ALWAYS. IN EVERY MODE.
   *
   * There is no `showModeLabel` here any more, and there must not be one again.
   * Earlier versions painted the mode name beside the icon whenever the panel was
   * wide, which put a permanent caption reading "موسّع" / "Expanded" at the foot
   * of an expanded sidebar. That caption is a control announcing its own state,
   * which is the one thing a state does not need saying: the sidebar is visibly
   * expanded — the user is looking at it. In expand-on-hover it was worse, since
   * the panel widens the instant the pointer crosses it, so the label flickered
   * in under your own cursor and printed the name of the mode you were already in.
   *
   * The mode NAMES live in the menu this control opens, which is the only moment
   * they are load-bearing: when the user is choosing between them. Until then the
   * icon is the whole control.
   *
   * Nothing is lost for assistive technology. The `aria-label` below still names
   * both the control and the active mode, so a screen reader announces strictly
   * more than the caption ever did. Only the PAINTED text is gone.
   */

  /* DESIGN-LAB PUSH BEHAVIOUR — see the prop's own note.
     The shared shell's spacer is a PLAIN, unanimated box: its width is the
     JS `resting` value, so it only ever changes on a mode switch, and a hover
     reveal (which changes `visual` without touching `resting`) leaves it
     untouched on purpose — the panel then overlays the page rather than
     resizing it, which is deliberate there (see the file header).
     Fady's prototype asks for the opposite: the sidebar is the application's
     own width changing, not a drawer floating over it, so the SPACER has to
     carry the same animated value the panel does. Doing that only costs
     handing it the identical `animate`/`transition` pair — the panel's own
     animation is untouched and the two stay in lockstep because they are
     driven by the same spring off the same `visual`, not because one waits
     on the other. */
  // `animate`/`transition` take Motion's own types, not `CSSProperties` — the
  // panel below gets away with an inline object literal because JSX gives it
  // contextual typing; pulled into a variable (so the spacer can share the
  // exact same value) that inference is lost, so both are typed loosely here
  // rather than fighting Motion's generics for a value this narrow.
  const springTransition = reduced
    ? { duration: 0 }
    : ({ type: "spring", stiffness: 520, damping: 42, mass: 1 } as const);
  const spacerAnimate: Record<string, string> | undefined = designLabAtmosphere
    ? { "--shell-nav-w": visual }
    : undefined;
  const spacerTransition = designLabAtmosphere ? springTransition : undefined;
  const spacerStyle: CSSProperties = designLabAtmosphere
    ? {
        width: "calc(var(--shell-nav-w) + var(--shell-gutter-w))",
        ["--shell-nav-w" as string]: visual,
        zIndex: 300,
        top: 0,
        height: "100dvh",
      }
    : { width: `calc(${resting} + var(--shell-gutter-w))`, zIndex: 300, top: 0, height: "100dvh" };

  const upgradeLabel = locale === "ar" ? "ترقية خطتك" : "Upgrade your plan";
  const modeControlLabel = `${t("nav.sidebar.control")}: ${t(sidebarModeLabelKey(mode))}`;

  return (
    <motion.div
      className="sticky hidden shrink-0 tablet:block"
      // FULL HEIGHT, FROM THE TOP OF THE VIEWPORT. It no longer starts beneath
      // the header, because the header no longer crosses it — see AppShell. That
      // is what makes the sidebar the outermost plane on its side rather than a
      // panel inside the page, and it is the precondition for the carve reading
      // as the body arriving rather than as a highlighted row.
      //
      // The reserved width INCLUDES THE GUTTER: the strip of frame between the
      // navy and the header card belongs to this component, because the carve
      // crosses it. See the panel below.
      //
      // z above the header (200) so a hover reveal floats over it rather than
      // sliding underneath, which reads as a rendering bug.
      initial={false}
      animate={spacerAnimate}
      transition={spacerTransition}
      style={spacerStyle}
      data-shell-sidebar=""
      data-sidebar-mode={mode}
      data-sidebar-open={open ? "true" : "false"}
      data-sidebar-push={designLabAtmosphere ? "true" : undefined}
    >
      <motion.div
        ref={panel}
        // Handlers live on the PANEL, not the spacer. The panel is one continuous
        // box at whatever width it currently has, so the pointer never crosses a
        // seam between "the thing that opened it" and "the thing it opened into" —
        // which is what makes hover reveals oscillate.
        onMouseEnter={hoverMode ? () => setRevealed(true) : undefined}
        onMouseLeave={hoverMode ? () => setRevealed(false) : undefined}
        onFocusCapture={hoverMode ? () => setRevealed(true) : undefined}
        onBlurCapture={
          hoverMode
            ? (e) => {
                // Keyboard users reveal by tabbing IN; only tabbing back out closes it.
                if (!panel.current?.contains(e.relatedTarget as Node | null)) setRevealed(false);
              }
            : undefined
        }
        className={cn(
          // The panel itself paints NOTHING — not a fill, and no longer a shadow
          // either. It is `--shell-nav-w` of shell plus `--shell-gutter-w` of
          // frame, and the shell is painted by the plate inside it. The
          // distinction earns its keep in exactly one place, and it is the
          // important one: the carve is a descendant of this box and reaches the
          // plate's trailing edge, so the light band ends where the material
          // ends. A `bg-shell` here would put material under the gutter and the
          // band would stop at a wall.
          "absolute inset-y-0 start-0 flex h-full flex-col",
        )}
        /* THE WIDTH ANIMATES AS A CUSTOM PROPERTY, NOT AS A WIDTH.
           `--shell-nav-w` is already the number three descendants size
           themselves from — the plate, the nav column and the footer — and the
           carve re-measures the nav on every resize. Animating the variable
           therefore moves all four in lockstep with one animated value, and the
           panel's own width stays an honest `calc()` against the gutter token
           instead of a hardcoded 280 that would silently drift the first time
           the gutter is retuned.

           A spring rather than a duration, matched to the carve's: they are one
           gesture, and two easings on one gesture is visible as the band lagging
           or leading the edge it is supposed to be flush with. */
        initial={false}
        animate={{ "--shell-nav-w": visual }}
        transition={
          reduced ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 42, mass: 1 }
        }
        style={
          {
            width: "calc(var(--shell-nav-w) + var(--shell-gutter-w))",
            // The resting value, so the FIRST paint is already the right width.
            // Server-rendered from the cookie; motion takes over from here.
            "--shell-nav-w": visual,
          } as CSSProperties
        }
      >
        {/* THE NAVY PLATE. Its own box, inset to `--shell-nav-w`, so the gutter
            beside it stays frame. `overflow-hidden` clips the atmosphere to the
            plate — without it the flow-lines and the tonal pools spill across the
            gutter and under the cards.

            THE CORNERS ARE SQUARE NOW. They carried `rounded-e-[2rem]`, on the
            reasoning that the reference's trailing edge is an organic curve and
            a large radius at head and foot is the honest part of that. It is
            not: a 32px radius at the FOOT lifts the shell off the bottom of the
            screen and puts a wedge of frame under it, so the panel reads as a
            tall floating card rather than as the room the page is standing in —
            and it produced exactly the closing edge across the bottom of the
            page that the body above has just stopped drawing. The reference's
            sidebar is full-bleed top to bottom; so is this. The trailing edge
            keeps its character from the gold hairline and the flow lines, which
            are the parts of that curve a carve can travel through. */}
        <div
          aria-hidden="true"
          className={cn(
            "absolute inset-y-0 start-0 overflow-hidden bg-shell",
            /* THE DEPTH CUE LIVES HERE, ON THE MATERIAL, and only while the
               shell is open over the page. It used to sit on the panel — which
               is the material PLUS the 40px gutter — so a hover reveal cast a
               shadow around an empty transparent strip and the strip read as a
               second floating surface beside the sidebar. On the plate it is the
               shell itself lifting, which is the only thing here that is a
               surface at all. */
            open && hoverMode && "shadow-[8px_0_28px_-8px_rgba(0,10,30,0.28)]",
          )}
          style={{ width: "var(--shell-nav-w)" }}
        >
          <ShellAtmosphere />
        </div>

        {/* THE LOCKUP.
            SHARED SHELL: the mark never leaves — it used to be suppressed
            entirely at rail width, on the reasoning that 56px cannot hold a
            wordmark. It cannot, but a wordmark is not the brand, and dropping
            the emblem with it meant the product had no identity on screen at
            all on a collapsed rail. Only the WORDMARK is conditional; the
            mark is the same element in the same place in both states.

            DESIGN-LAB: the brief asks for the OPPOSITE at rail width — the
            control REPLACES the mark rather than sitting beside a shrunken
            version of it, so collapsed mode opens on one centred control, not
            a logo with a second small icon stacked under it. `AnimatePresence`
            crossfades the swap (mark ⇄ control) rather than a hard cut, which
            would otherwise read as a flash on every collapse/expand — the
            width itself is already animating on the same spring, so the
            content inside gets the same treatment. */}
        <div
          className={cn(
            "relative z-10 flex h-16 shrink-0 items-center",
            narrow ? "justify-center px-2" : "px-5",
            designLabAtmosphere && !narrow && "justify-between",
          )}
          style={{ width: "var(--shell-nav-w)" }}
        >
          {designLabAtmosphere ? (
            <>
              {/* THE MARK LEADS, THE CONTROL TRAILS — reverted back from a
                  control-first row: adjacent-and-left read as tidier in
                  isolation, but put the toggle where a reader's eye lands
                  FIRST on every load, ahead of the product's own name. The
                  brand belongs at the leading edge; the control is a utility
                  and sits at the row's far side, spread there by
                  `justify-between` rather than a gap, so it lands in the
                  same corner the reference does. The mark fades OUT going
                  narrow and back IN going wide — mount/unmount, not a shared
                  element, since it has nowhere to travel to (the control
                  holds its own end of the row throughout). */}
              <AnimatePresence initial={false}>
                {!narrow ? (
                  <motion.div
                    key="brand"
                    layout
                    initial={reduced ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={reduced ? undefined : { opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <Brand name={appName} size="sm" tone="shell" wordmark />
                  </motion.div>
                ) : null}
              </AnimatePresence>
              {/* The control never unmounts; `layout` alone gives it a smooth
                  FLIP between centred (narrow, alone) and trailing-edge
                  (wide, beside the mark) as the row's own `justify-content`
                  swaps. */}
              <motion.div layout={!reduced}>
                <SidebarModeControl mode={mode} menuAlign="down" onPick={choose} ariaLabel={modeControlLabel} />
              </motion.div>
            </>
          ) : (
            <Brand name={appName} size="sm" tone="shell" wordmark={!narrow} />
          )}
        </div>

        {/* The grouped rail can exceed the viewport on a short screen, so it owns
            its own scroll rather than clipping the last section.

            IT SPANS THE WHOLE PANEL, GUTTER INCLUDED, and that is load-bearing
            rather than incidental. `overflow-y: auto` establishes a scroll
            container that clips on BOTH axes — there is no way to scroll
            vertically and overflow horizontally — so a scroller sized to the navy
            alone would cut the carve off at exactly the edge it exists to cross.
            The rows inside are held to `--shell-nav-w` by the <nav>'s own width,
            so nothing but the carve ever enters the gutter.

            The scrollbar is hidden rather than styled. It would otherwise be
            drawn 40px out in the gutter, detached from the list it scrolls and
            sitting on top of the frame between two cards. */}
        <div className="relative z-10 min-h-0 flex-1 shrink grow overflow-y-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Sidebar
            allowed={allowed}
            narrow={narrow}
            stance={stance}
            /* EVERY desktop mode carves. It was `mode === "expanded"`, which is
               the split this pass removed — see the prop's own note. The carve
               reads `narrow` and changes shape; it does not need protecting from
               a width. */
            carved
            collapsibleSections={designLabAtmosphere}
          />
        </div>

        {designLabAtmosphere ? (
          /* DESIGN-LAB BOTTOM ACTIONS — structurally fixed, not just visually.
             TOP (brand/control) and this BOTTOM block are both `shrink-0`;
             the nav list between them is the only flex item allowed to grow
             OR shrink (`min-h-0 flex-1 shrink grow`, both stated explicitly
             rather than left to the default). Without an explicit `shrink-0`
             here, this block was a `flex-shrink: 1` item like any other —
             the browser's default — so on a tall navigation list it would
             shrink BELOW its own content height right along with the nav
             list instead of staying fixed, and Settings/Upgrade rendered
             overlapping whatever text no longer had room. `shrink-0` is the
             actual fix; the list is `overflow-y-auto` for exactly the
             overflow this creates, so a long list scrolls instead of both
             fighting for the same space. Sits AFTER the scrolling list as a
             sibling, so it can never be scrolled UNDER either. Replaces the
             org/branch card: that context already lives in the header's own
             workspace switcher, so repeating it here was the same fact
             twice rather than a second one worth the space. */
          <div
            /* NO BORDER, NO SEPARATE GROUND HERE. This used to be `border-t
               border-shell-line bg-shell` — a rule plus a fill that read as a
               second component stitched onto the foot of the list rather
               than the same sidebar continuing. The plate underneath is
               already `bg-shell` for the whole panel, so repeating the fill
               here painted nothing different and the border was the only
               thing actually visible: a seam with no structural reason to
               exist. Dropping both leaves Settings and Upgrade sitting on
               the identical material the nav list above them does. */
            className={cn("relative z-10 shrink-0 py-2", navColumnClass(narrow))}
            style={{ width: "var(--shell-nav-w)" }}
          >
            <Link
              href="/b2b/settings"
              className={cn(
                "flex items-center rounded-sm text-label font-medium text-shell-fg-secondary",
                "hover:bg-shell-2 hover:text-shell-fg",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-shell",
                navRowClass(narrow),
              )}
            >
              <span className={cn(navIconClass(), "text-shell-fg-secondary")}>
                <SettingsIcon size={NAV_ICON_SIZE} />
              </span>
              {narrow ? null : <span className="truncate">{t("nav.settings")}</span>}
            </Link>

            {/* THE ONE LUMEN MOMENT ON THE SHELL BESIDE THE FLOW-LINES. ONE
                SURFACE — the row itself — not two: the icon used to carry
                its OWN `bg-shell-gold-soft` tile on top of the row's
                identical background, and stacking two translucent fills of
                the same colour compounds their opacity, so the icon's
                36px square read as a visibly darker box nested inside a
                larger, lighter one — "two backgrounds" exactly as it looked.
                The icon is transparent now and only the row paints, so icon
                and label sit on the SAME ground. `rounded-md` (one step up
                from a nav row's `rounded-sm`) is deliberate too: this row is
                a BUTTON, not another link in the list, and the shape says so
                at a glance. Narrow mode gets this for free rather than a
                second treatment: the row is still full-width and centred, so
                the same single fill draws as a compact tinted box around the
                icon alone. */}
            <Link
              href="/b2b/settings"
              className={cn(
                "flex items-center rounded-md text-label font-medium text-accent-solid",
                "bg-shell-gold-soft hover:bg-shell-gold/30",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-shell",
                navRowClass(narrow),
              )}
            >
              <span className={cn(navIconClass(), "text-accent-solid")}>
                <TrendingUpIcon size={NAV_ICON_SIZE} />
              </span>
              {narrow ? null : <span className="truncate">{upgradeLabel}</span>}
            </Link>
          </div>
        ) : (
          <>
            {/* THE WORKSPACE CARD. Which organization this is, and which of its
                branches the reader is scoped to — the two facts that decide what
                every number on the page counts. It sits at the foot of the panel
                because it is REFERENCE, not navigation: read once on arrival and then
                ignored, which is the one thing the bottom of a rail is good for.

                Raised onto the navy with `shell-2` rather than outlined, so it reads
                as a card resting ON the material instead of a hole cut into it.
                Suppressed on the rail, which has width for neither line. */}
            {narrow ? null : (
              <div className="relative z-10 px-4 pb-3" style={{ width: "var(--shell-nav-w)" }}>
                <div className="rounded-md border border-shell-line bg-shell-2 px-3 py-2.5">
                  <p className="truncate text-label font-semibold text-shell-fg">{orgName}</p>
                  {branchName ? (
                    <p className="mt-0.5 truncate text-caption text-shell-fg-muted">{branchName}</p>
                  ) : null}
                </div>
              </div>
            )}

            {/* The footer takes the SAME column inset as the nav list above it, and
                the control inside takes the same row and icon geometry as a nav link
                — see lib/ui/nav-geometry. Both were previously hand-set here and
                drifted 4px inboard of the icons they sit under. */}
            <div
              className={cn("relative z-10 border-t border-shell-line py-2", navColumnClass(narrow))}
              style={{ width: "var(--shell-nav-w)" }}
            >
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                /* The accessible name carries what the icon cannot: what this control
                   is AND which mode is currently active. That is the whole reason the
                   visible caption can go — nothing is lost for a screen reader, only
                   the painted text disappears. */
                aria-label={`${t("nav.sidebar.control")}: ${t(sidebarModeLabelKey(mode))}`}
                data-testid="sidebar-control"
                /* THE ROW ITSELF HAS NO HOVER STATE. NOT IN ANY MODE.
                   The button stays `w-full` so the CLICK target still matches a nav
                   row, but a target and a hover surface are not the same thing here:
                   a nav row paints on hover because its whole width is label and
                   icon, whereas this row is a 36px icon followed by up to 200px of
                   nothing. Tinting that emptiness announced a control the pointer was
                   nowhere near, which is the same defect as the group-driven tile,
                   one element out. Every visible hover cue now comes from the tile
                   below — `hover:` on the span, not `group-hover:` here. Do not add
                   `hover:` anything to this element again.
                   Focus is untouched: the ring is a keyboard affordance, not hover
                   feedback, and it lands on this button because this button is what
                   takes focus. */
                className={cn(
                  "group flex w-full items-center rounded-sm text-label font-medium text-shell-fg-secondary",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-shell",
                  // Keyed to `narrow` — the PANEL's width — and never to whether the
                  // control has a label, because it never has one.
                  //
                  // This is what keeps icon-only from meaning centred. An expanded
                  // panel is 15rem wide, so a `justify-center` row would park this
                  // glyph 120px from where every navigation icon above it sits, and
                  // the fix for the misalignment would have created a worse one. An
                  // expanded row therefore keeps its `px-3` start inset and simply
                  // has nothing after the icon; the button still spans the full width
                  // so the click target matches a nav row, but the glyph stays in the
                  // column. RTL follows for free — `px` is logical, so the inset is on
                  // the right in Arabic without a second rule.
                  navRowClass(narrow),
                )}
              >
                <span
                  className={cn(
                    navIconClass(),
                    // The same lit tile the nav icons above use, in every mode — this
                    // control sits in their column, so it must answer a pointer the
                    // way they do — but armed by the TILE, not by the row.
                    //
                    // A nav row can be row-driven because the row IS the target: its
                    // label, icon and padding all go to one href. This button has no
                    // label. It is `w-full` only so the CLICK target matches a nav
                    // row, so a row-driven tile lit from anywhere along the footer —
                    // the pointer could sit 200px away over empty space and the icon
                    // still glowed, which reads as the whole bottom of the sidebar
                    // reacting to a pointer that is nowhere near it. Scoped to the
                    // span, the paint follows the pointer actually on it, in all
                    // three modes.
                    //
                    // `group-focus-visible:` is the keyboard half and stays: a span
                    // cannot take focus, so the group it reads is the one focusable
                    // control that owns this tile — its own focus, not the footer's.
                    // Not NAV_ICON_SELF_HOVER_CLASS: that constant paints
                    // `bg-surface-2`, a CONTENT token tuned against Quartz, which on
                    // this navy ground is both nearly invisible and semantically
                    // wrong. Same appearance contract, same self-scoped trigger (the
                    // pointer must be over the 36px tile, not anywhere along a
                    // label-less full-width row) — shell ground instead.
                    "hover:bg-shell-2 group-focus-visible:bg-shell-2",
                    "text-shell-fg-muted hover:text-shell-fg group-focus-visible:text-shell-fg",
                  )}
                >
                  <PanelIcon size={NAV_ICON_SIZE} />
                </span>
              </button>

              {menuOpen ? (
                <div
                  role="menu"
                  data-testid="sidebar-menu"
                  // Opens upward and inward. At 3.5rem it overflows the rail on
                  // purpose — the panel has no `overflow-hidden` for exactly this.
                  className={cn(menuSurfaceClass, "absolute bottom-full start-0 mb-1 w-56 z-popover")}
                >
                  <ul className="flex flex-col py-0.5">
                    {SIDEBAR_MODES.map((value) => {
                      const selected = value === mode;
                      return (
                        <li key={value}>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => choose(value)}
                            aria-current={selected ? "true" : undefined}
                            data-testid={`sidebar-mode-${value}`}
                            className={menuItemClass(selected)}
                          >
                            <span className="truncate">{t(sidebarModeLabelKey(value))}</span>
                            {selected ? <CheckIcon size={16} className="ms-auto shrink-0 text-accent" /> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
