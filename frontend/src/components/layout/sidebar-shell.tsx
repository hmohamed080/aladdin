"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion, useMotionValue, animate } from "motion/react";
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
 * The top display-mode control.
 *
 * TWO SEPARATE GESTURES, ONE ELEMENT — a click and a hover mean different
 * things here, which the earlier shell's version did not attempt: there a click
 * opened the same 3-option menu every time. The approved reference (and most
 * rails that put this control up top) splits it: a CLICK is the one choice you
 * make most often — flip between expanded and collapsed — and a HOVER is for the
 * rarer, deliberate choice of a specific mode, "Expand on hover" included.
 * Collapsing both into one menu-behind-a-click makes the common case cost two
 * clicks: open the menu, then pick the state you are already looking at.
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
}: {
  allowed: readonly string[];
  mode: SidebarMode;
  /**
   * The product name, for the lockup at the head of the panel.
   *
   * The brand lives HERE and not in the header. It moved because the header
   * stopped spanning the viewport: a lockup inside a card that begins 280px in
   * is no longer introducing the application, it is decorating one of two cards.
   * At the top of the full-height sidebar it is the first thing on the screen
   * again, which is the job it was always doing.
   *
   * `orgName` / `branchName` USED TO BE HERE and deliberately are not any more.
   * They fed a workspace card at the foot of the panel, which the fixed
   * Settings/Upgrade block replaced: the same organization and branch are
   * already on screen in the header's own workspace switcher, so the card was
   * stating one fact twice rather than a second fact worth the space.
   */
  appName: string;
  /**
   * Which seat this workspace leads from. It reaches only as far as `Sidebar`,
   * which uses it to order and label the modules. Every display mode, the hover
   * reveal, the RTL geometry and the mode cookie are stance-independent — this is
   * ONE sidebar serving every B2B organization, not a Showroom one and a
   * Distributor one.
   */
  stance?: CommerceStance;
}) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const [mode, setMode] = useState<SidebarMode>(initialMode);
  const [revealed, setRevealed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  // A hover reveal must survive the trip to its own control menu — collapsing the
  // panel out from under an open menu would close it mid-choice.
  const open = mode === "expanded" || ((revealed || menuOpen) && mode === "hover");
  const narrow = !open;
  /* ONE WIDTH, NOT TWO. There used to be a second `resting` value here — the
     width the SPACER held regardless of a hover reveal, which is what let the
     panel float over the page instead of pushing it. Now that the spacer tracks
     the panel (see below), `resting` and `visual` only ever differed mid-reveal,
     and keeping both invited them to drift. First paint is still correct without
     it: `open` is false for a fresh `hover` mode, so the server-rendered width is
     the rail, exactly as the mode cookie asks. */
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

  /* THE SIDEBAR PUSHES THE PAGE; IT DOES NOT FLOAT OVER IT.
     The earlier shell's spacer was a PLAIN, unanimated box: its width was the JS
     `resting` value, so it only changed on a mode switch, and a hover reveal
     (which changes `visual` without touching `resting`) left it untouched — the
     panel then overlaid the page rather than resizing it.

     The approved direction is the opposite: the sidebar widening IS the
     application's own width changing, not a drawer sliding over it. So the
     SPACER carries the same animated value the panel does — and it now carries
     the SAME VALUE OBJECT rather than a second animation given identical
     arguments, so the two cannot drift apart even in principle.

     The width the server renders is still the mode cookie's (read in
     `AppShell`), so first paint is correct before this spring ever runs. */
  /* ONE WRITER FOR `--shell-nav-w`, AND THAT IS THE WHOLE FIX.
     ---------------------------------------------------------------------
     The width used to have TWO owners. Every render passed the resolved string
     to React through `style={{ "--shell-nav-w": visual }}`, and the same string
     to Motion through `animate={{ "--shell-nav-w": visual }}`. Both then wrote
     the same custom property on the same element, and they write it on
     different schedules: React only touches the DOM when the string CHANGES
     between two renders, while Motion writes it every frame of a spring and
     stops wherever it was stopped.

     That is enough to desynchronise state from geometry, and it was observed
     doing exactly that: `data-sidebar-mode="expanded"`, `data-sidebar-open="true"`
     — so React had computed `visual` as the expanded width — while the property
     itself still read `3.5rem`, the rail. The reason neither owner corrected it
     is the same fact from both sides: an interrupted Motion animation leaves the
     property at an arbitrary value, and if `visual` is UNCHANGED across the next
     render (which it is on `hover` -> `expanded`, because `open` is true either
     way) React writes nothing and Motion re-targets nothing. Both writers
     believe the value is already correct; the DOM disagrees with both.

     So the property now has exactly one writer: this MotionValue. React never
     puts the raw string in `style` again — it passes the VALUE OBJECT, which
     Motion renders on the server from `.get()` (first paint stays correct, off
     the mode cookie) and owns exclusively on the client.

     The animation is driven from an effect keyed on the TARGET rather than from
     a render-time prop. That is what makes the transition authoritative: the
     effect re-runs only when the target genuinely changes, and when it does it
     animates from wherever the value actually IS to where the state says it
     should be. An interrupted animation cannot strand the property any more,
     because the next target change starts from the real current value, and an
     unchanged target leaves the in-flight animation alone to finish.

     Nothing about the motion itself moves: same spring, same widths, same
     reduced-motion behaviour. */
  const navWidth = useMotionValue(visual);
  useEffect(() => {
    const controls = animate(
      navWidth,
      visual,
      reduced ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 42, mass: 1 },
    );
    return () => controls.stop();
  }, [navWidth, visual, reduced]);

  const spacerStyle = {
    width: "calc(var(--shell-nav-w) + var(--shell-gutter-w))",
    "--shell-nav-w": navWidth,
    zIndex: 300,
    top: 0,
    height: "100dvh",
  } as unknown as CSSProperties;

  /* THROUGH THE MESSAGE CATALOGUE, NOT A TERNARY ON `locale`. While this was a
     one-account prototype an inline `locale === "ar" ? ... : ...` was a
     shortcut with a known expiry; shipped, it is a string the AR/EN parity check
     cannot see and the next locale silently falls back to English on. */
  const upgradeLabel = t("nav.upgrade");
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
      style={spacerStyle}
      data-shell-sidebar=""
      data-sidebar-mode={mode}
      data-sidebar-open={open ? "true" : "false"}
      data-sidebar-push="true"
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
        style={
          {
            width: "calc(var(--shell-nav-w) + var(--shell-gutter-w))",
            // THE SAME MotionValue THE SPACER USES — not a second copy of the
            // same number. The two are now in lockstep because they are reading
            // one value object, rather than because two springs were given
            // identical arguments and trusted to stay in step.
            "--shell-nav-w": navWidth,
          } as unknown as CSSProperties
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

        {/* THE TOP CONTROL ROW — the lockup and the display-mode control.
            EXPANDED: the mark leads at the row's leading edge and the control
            trails at its far side, spread by `justify-between` rather than a
            gap so it lands in the same corner the reference does. This ordering
            was reverted back from a control-first row: adjacent-and-leading read
            as tidier in isolation, but put a utility toggle where the reader's
            eye lands FIRST on every load, ahead of the product's own name.
            COLLAPSED: the control REPLACES the mark rather than sitting beside a
            shrunken version of it, so the rail opens on one centred control
            instead of a logo with a second small icon stacked under it.
            `AnimatePresence` crossfades the swap rather than hard-cutting it,
            which would read as a flash on every collapse/expand — the width is
            already animating on the same spring, so the content inside gets the
            same treatment. */}
        <div
          className={cn(
            "relative z-10 flex h-16 shrink-0 items-center",
            narrow ? "justify-center px-2" : "justify-between px-5",
          )}
          style={{ width: "var(--shell-nav-w)" }}
        >
          {/* The mark fades OUT going narrow and back IN going wide —
              mount/unmount rather than a shared element, since it has nowhere to
              travel to (the control holds its own end of the row throughout). */}
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
          {/* The control never unmounts; `layout` alone gives it a smooth FLIP
              between centred (narrow, alone) and trailing-edge (wide, beside the
              mark) as the row's own `justify-content` swaps. */}
          <motion.div layout={!reduced}>
            <SidebarModeControl
              mode={mode}
              menuAlign="down"
              onPick={choose}
              ariaLabel={modeControlLabel}
            />
          </motion.div>
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
          />
        </div>

        {
          /* THE BOTTOM ACTIONS — structurally fixed, not just visually.
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
            {/* `aria-label` ON THE NARROW RAIL, and it is required rather than
                tidy. Collapsed, this row renders an icon and NOTHING ELSE, so
                without it the link has no accessible name at all — a screen
                reader announces "link" and stops, and both bottom rows point at
                the same href, so the two are indistinguishable. Every nav row
                above already does this (see `NavLink`); these two were the pair
                that did not. Only when narrow: with the label painted, a
                duplicate `aria-label` would just talk over it. */}
            <Link
              href="/b2b/settings"
              aria-label={narrow ? t("nav.settings") : undefined}
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
              aria-label={narrow ? upgradeLabel : undefined}
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
        }
      </motion.div>
    </motion.div>
  );
}
