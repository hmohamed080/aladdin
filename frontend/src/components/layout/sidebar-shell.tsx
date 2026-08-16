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
import { Sidebar } from "@/components/layout/workspace-nav";
import { Brand } from "@/components/layout/brand";
import { ApertureMark, CheckIcon, PanelIcon } from "@/components/ui/icons";

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
  appName,
  allowed,
  mode: initialMode,
}: {
  appName: string;
  allowed: readonly string[];
  mode: SidebarMode;
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

  return (
    <div
      className="sticky top-0 hidden h-dvh shrink-0 tablet:block"
      // Above the sticky header (200) so a reveal floats over it rather than
      // sliding underneath, which reads as a rendering bug.
      style={{ width: resting, zIndex: 300 }}
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
        <div className={cn("py-lg", narrow ? "grid place-items-center px-0" : "px-5")}>
          {narrow ? (
            // The wordmark has no room at 3.5rem; the mark alone still holds the
            // brand and keeps the rail's optical top aligned with the header.
            <span aria-label={appName} role="img">
              <ApertureMark size={26} />
            </span>
          ) : (
            <Brand name={appName} size="md" />
          )}
        </div>

        {/* The grouped rail can exceed the viewport on a short screen, so it owns
            its own scroll rather than clipping the last section. */}
        <div className={cn("min-h-0 flex-1 overflow-y-auto pb-lg", narrow ? "px-2" : "px-3")}>
          <Sidebar allowed={allowed} narrow={narrow} />
        </div>

        <div className="relative border-t p-2">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t("nav.sidebar.control")}
            data-testid="sidebar-control"
            className={cn(
              "flex w-full items-center rounded-sm py-2 text-label font-medium text-fg-secondary transition-colors",
              "hover:bg-surface-2/60 hover:text-fg",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
              narrow ? "justify-center px-0" : "gap-3 px-3",
            )}
          >
            <PanelIcon size={19} className="shrink-0 text-fg-muted" />
            {narrow ? null : <span className="truncate">{t(sidebarModeLabelKey(mode))}</span>}
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
