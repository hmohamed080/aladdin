"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import {
  SIDEBAR_MODE_COOKIE,
  SIDEBAR_MODES,
  SIDEBAR_WIDTH,
  sidebarModeLabelKey,
  type SidebarMode,
} from "@/lib/ui/sidebar-mode";
import {
  navColumnClass,
  navIconClass,
  navRowClass,
  NAV_ICON_SELF_HOVER_CLASS,
  NAV_ICON_SIZE,
} from "@/lib/ui/nav-geometry";
import { Sidebar } from "@/components/layout/workspace-nav";
import { CheckIcon, PanelIcon } from "@/components/ui/icons";
import type { CommerceStance } from "@/lib/workspace/supply-side";

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * The desktop/tablet workspace sidebar and its three display modes.
 *
 * WHY TWO NESTED BOXES
 * The outer box is a SPACER: it is the flex child that reserves horizontal room
 * in the shell, and its width is the RESTING width of the chosen mode. The inner
 * panel is absolutely positioned and carries the VISUAL width. In expanded and
 * collapsed modes the two agree and nothing moves. In expand-on-hover they
 * deliberately disagree: the panel grows to 15rem while the spacer stays at
 * 3.5rem, so the reveal floats inward over the page instead of reflowing it.
 * Widening a flex child on hover would relayout the entire document on every
 * pointer pass — that is the "continuously resizing/shifting the body" the brief
 * rules out, and it is also where the flicker comes from.
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
}: {
  allowed: readonly string[];
  mode: SidebarMode;
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

  return (
    <div
      className="sticky hidden shrink-0 tablet:block"
      // It starts BENEATH the top header now, so both its sticky offset and its
      // height come from the same `--app-header-h` the header sizes itself with;
      // a literal 48px in either place is how the rail ends up 4px past the fold.
      // z above the header (200) so a hover reveal floats over it rather than
      // sliding underneath, which reads as a rendering bug.
      style={{
        width: resting,
        zIndex: 300,
        top: "var(--app-header-h)",
        height: "calc(100dvh - var(--app-header-h))",
      }}
      data-sidebar-mode={mode}
      data-sidebar-open={open ? "true" : "false"}
    >
      <div
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
          "absolute inset-y-0 start-0 flex h-full flex-col border-e bg-surface",
          "transition-[width] duration-base ease-standard motion-reduce:transition-none",
          // Depth only while floating, so the resting rail stays flush.
          open && mode === "hover" && "shadow-lg",
        )}
        style={{ width: visual }}
      >
        {/* NO BRAND HERE ANY MORE. The mark lives in the top header, which spans
            the viewport and is present on every authenticated surface, so the
            product is named once and in one place. Drawing it here as well gave
            a collapsed rail a 26px glyph standing in for the wordmark and put
            two Aladdin marks 12px apart on the personal surface. */}

        {/* The grouped rail can exceed the viewport on a short screen, so it owns
            its own scroll rather than clipping the last section. */}
        <div className={cn("min-h-0 flex-1 overflow-y-auto py-md", navColumnClass(narrow))}>
          <Sidebar allowed={allowed} narrow={narrow} stance={stance} />
        </div>

        {/* The footer takes the SAME column inset as the nav list above it, and
            the control inside takes the same row and icon geometry as a nav link
            — see lib/ui/nav-geometry. Both were previously hand-set here and
            drifted 4px inboard of the icons they sit under. */}
        <div className={cn("relative border-t py-2", navColumnClass(narrow))}>
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
              "group flex w-full items-center rounded-sm text-label font-medium text-fg-secondary",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
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
                NAV_ICON_SELF_HOVER_CLASS,
                "text-fg-muted hover:text-fg group-focus-visible:text-fg",
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
              className="absolute bottom-full start-0 mb-1 w-56 overflow-hidden rounded-md border border-strong bg-surface shadow-lg"
              style={{ zIndex: 600 }}
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
                        className={cn(
                          "flex w-full items-center gap-2.5 px-3 py-2 text-start text-body text-fg transition-colors",
                          "hover:bg-surface-2/70 focus-visible:outline-none focus-visible:bg-surface-2/70",
                          selected && "bg-accent-solid/10",
                        )}
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
      </div>
    </div>
  );
}
