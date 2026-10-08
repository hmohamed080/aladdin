"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { autoUpdate, flip, offset, shift, size, useFloating, type Placement } from "@floating-ui/react-dom";
import { cn } from "@/lib/ui/cn";
import { menuSurfaceClass } from "./menu";

/**
 * THE ONE FLOATING SURFACE for every dropdown, menu, listbox and popover.
 *
 * WHY THIS EXISTS. A menu drawn as `absolute top-full` inside its trigger's wrapper lives in the layout of
 * every ancestor. Any ancestor with `overflow: hidden | auto | clip`, a transform or a containing block clips
 * it (a z-index cannot escape that), and nothing moves it away from the viewport edge, so a start-anchored menu
 * wider than its trigger ran off-screen in Arabic and on phones. Both are structural; neither can be fixed one
 * page at a time.
 *
 * WHAT IT DOES.
 *   - renders into ONE overlay root on <body> (a portal), so no ancestor can clip it;
 *   - positions it with Floating UI: `position: fixed`, flipped above/below when there is no room, shifted
 *     back inside the viewport (12px gutter), height-capped to the room left and scrolling inside, never
 *     narrower than the trigger when asked to match it, re-computed on scroll of ANY ancestor and on resize;
 *   - RTL-aware: `-start` / `-end` placements follow the writing direction of the page;
 *   - uses the shared surface (`menuSurfaceClass`) and the shared `z-popover` layer.
 *
 * WHAT STAYS WITH THE CALLER: what is inside (items), which role it has, and when it is open. This component
 * owns the BEHAVIOUR every menu shares and nobody should re-implement: Escape and outside-pointer dismissal,
 * focus returning to the trigger, Tab leaving the menu, and Arrow Up / Down / Home / End moving between items.
 *
 * Items are any elements carrying a `menuitem*` or `option` role (or `data-menu-item`); disabled ones are skipped.
 */

export const OVERLAY_VIEWPORT_PADDING = 12;

/** The height a surface may take: the room left in the viewport (never below ~7 rows), further capped by the caller's own bound. */
export function resolveMenuMaxHeight(availableHeight: number, cap?: number): number {
  const room = Math.max(140, Math.floor(availableHeight));
  return cap ? Math.min(cap, room) : room;
}
const OVERLAY_ROOT_ID = "overlay-root";
const ITEM_SELECTOR = '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],[role="option"],[data-menu-item]';

/** The single overlay root every floating surface mounts into. Created once, on demand, on the client. */
function overlayRoot(): HTMLElement {
  let root = document.getElementById(OVERLAY_ROOT_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = OVERLAY_ROOT_ID;
    document.body.appendChild(root);
  }
  return root;
}

function enabledItems(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter(
    (item) => !item.hasAttribute("disabled") && item.getAttribute("aria-disabled") !== "true",
  );
}

export function FloatingMenu({
  open,
  onClose,
  anchorRef,
  children,
  role = "menu",
  placement = "bottom-start",
  matchAnchorWidth = false,
  maxHeight,
  returnFocus = true,
  className,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "data-testid": testId,
}: {
  open: boolean;
  /** Called for Escape, an outside pointer press, and Tab. The caller closes its own state. */
  onClose: () => void;
  /** The trigger. Positioning is relative to it; presses on it are not "outside"; focus returns to it. */
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  /** `menu` (action list) / `listbox` (single choice) / `dialog` (free-form popover). */
  role?: "menu" | "listbox" | "dialog";
  placement?: Placement;
  /** The surface is at least as wide as the trigger. */
  matchAnchorWidth?: boolean;
  /**
   * An upper bound, in px, on the surface's height (it scrolls inside). The surface is ALWAYS also limited to the room left in
   * the viewport; this is the product's own cap for a list that can be long (28 governorates must not become a 900px column).
   * It lives here, not in a class, because the sizing below writes an inline `max-height` that a class cannot out-rank.
   */
  maxHeight?: number;
  /** Return focus to the trigger on Escape / Tab (default true). */
  returnFocus?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "data-testid"?: string;
}) {
  const typed = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const [mounted, setMounted] = useState(false);
  const [scope, setScope] = useState<{ installer: boolean; theme?: string; dir: "ltr" | "rtl" }>({ installer: false, dir: "ltr" });
  const floatingEl = useRef<HTMLDivElement | null>(null);

  const { refs, floatingStyles, update, placement: resolvedPlacement } = useFloating({
    open,
    placement,
    strategy: "fixed",
    middleware: [
      offset(4),
      flip({ padding: OVERLAY_VIEWPORT_PADDING, fallbackStrategy: "bestFit" }),
      shift({ padding: OVERLAY_VIEWPORT_PADDING, crossAxis: true }),
      size({
        padding: OVERLAY_VIEWPORT_PADDING,
        apply({ rects, availableHeight, elements }) {
          // The room left in the chosen direction (never below ~7 rows), further capped by the caller's own `maxHeight`.
          // The surface scrolls inside itself either way.
          elements.floating.style.maxHeight = `${resolveMenuMaxHeight(availableHeight, maxHeight)}px`;
          elements.floating.style.minWidth = matchAnchorWidth ? `${Math.round(rects.reference.width)}px` : "";
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => setMounted(true), []);

  // Anchor to the trigger whenever the menu opens (the ref is read at open time, so a re-mounted trigger is followed).
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    refs.setReference(anchor);
    // The portal leaves the trigger's DOM subtree, so it also leaves any THEME SCOPE the subtree declared. The
    // installer palette is scoped to `.installer-surface` (styles/installer-theme.css): carry that scope, and the
    // writing direction, across with the surface so a portaled menu looks exactly like one that never left.
    const surface = anchor?.closest<HTMLElement>(".installer-surface") ?? null;
    setScope({
      installer: Boolean(surface),
      theme: surface?.dataset.installerTheme,
      // The nearest explicit `dir` (the document, or an installer wrapper) wins; the computed direction is the fallback.
      dir: (anchor?.closest("[dir]")?.getAttribute("dir") ?? (anchor ? getComputedStyle(anchor).direction : "ltr")) === "rtl" ? "rtl" : "ltr",
    });
  }, [open, anchorRef, refs]);

  const setFloating = useCallback(
    (node: HTMLDivElement | null) => {
      floatingEl.current = node;
      refs.setFloating(node);
    },
    [refs],
  );

  const close = useCallback(
    (restoreFocus: boolean) => {
      onClose();
      if (restoreFocus && returnFocus) anchorRef.current?.focus();
    },
    [onClose, returnFocus, anchorRef],
  );

  // Outside press and Escape. Registered only while open.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (floatingEl.current?.contains(target) || anchorRef.current?.contains(target)) return;
      close(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Only when focus is on the trigger or inside the menu (or nowhere): a menu inside a dialog must not close the dialog's own handler.
      event.stopPropagation();
      close(true);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer, { passive: true });
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, close, anchorRef]);

  // Re-measure after content changes size (a menu that filters as you type).
  useEffect(() => {
    if (open) update();
  }, [open, children, update]);

  if (!open || !mounted || typeof document === "undefined") return null;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // An item that handled the key itself (its own roving logic) is not handled twice.
    if (event.defaultPrevented) return;
    if (event.key === "Tab") {
      // Tab leaves the menu: close and hand focus back so the browser continues from the trigger, not from the
      // end of the document where the portal lives.
      close(true);
      return;
    }
    if (role === "dialog") return;
    const items = enabledItems(floatingEl.current);
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = index < 0 || index === items.length - 1 ? 0 : index + 1;
    else if (event.key === "ArrowUp") next = index <= 0 ? items.length - 1 : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    // Type-ahead: a printable character jumps to the next item whose label starts with what was typed
    // (a long list — governorates, countries — is otherwise a scroll).
    if (next === null && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== " ") {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at > 700 ? "" : typed.current.text) + event.key.toLowerCase(), at: now };
      const needle = typed.current.text;
      const from = Math.max(index, 0) + (needle.length === 1 ? 1 : 0);
      const ordered = [...items.slice(from), ...items.slice(0, from)];
      const hit = ordered.find((item) => (item.textContent ?? "").trim().toLowerCase().startsWith(needle));
      if (hit) {
        event.preventDefault();
        hit.focus();
      }
      return;
    }
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  };

  return createPortal(
    <div className={cn("contents", scope.installer && "installer-surface")} data-installer-theme={scope.theme} dir={scope.dir}>
      <div
        ref={setFloating}
        id={id}
        role={role}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        data-floating-menu=""
        data-placement={resolvedPlacement}
        data-testid={testId}
        style={floatingStyles}
        onKeyDown={onKeyDown}
        className={cn(menuSurfaceClass, "z-popover overflow-y-auto", className)}
      >
        {children}
      </div>
    </div>,
    overlayRoot(),
  );
}
