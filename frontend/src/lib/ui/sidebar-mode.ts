/**
 * Desktop workspace-sidebar display preference.
 *
 * WHY A COOKIE AND NOT localStorage
 * The preference decides the sidebar's WIDTH, which is layout, not decoration.
 * Read from localStorage it would only be known after hydration, so every load
 * would paint a 15rem rail and then snap to 3.5rem — exactly the flash the brief
 * rules out. A cookie travels with the document request, so the server renders
 * the correct width in the FIRST byte and hydration is a no-op.
 *
 * It stays a per-browser preference either way: no row is written anywhere, and
 * nothing here reaches the database. Mirrors the existing theme/locale cookies.
 */
export const SIDEBAR_MODE_COOKIE = "aladdin-sidebar";

/**
 * `expanded` — icons + labels + section headings, fixed width.
 * `collapsed` — permanent icon rail; labels live in the accessible name only,
 *                and hover/focus lights the icon's own tile (no visible caption).
 * `hover`     — rests collapsed, reveals over the page while pointed at or focused.
 */
export type SidebarMode = "expanded" | "collapsed" | "hover";

export const SIDEBAR_MODES: readonly SidebarMode[] = ["expanded", "collapsed", "hover"];

/** Unknown/absent cookie falls back to the current behaviour (fully expanded). */
export function resolveSidebarMode(value: string | undefined): SidebarMode {
  return value === "collapsed" || value === "hover" ? value : "expanded";
}

/** Resting widths. The rail reserves layout space; a hover reveal must not. */
export const SIDEBAR_WIDTH = { expanded: "15rem", rail: "3.5rem" } as const;

/** Translation key for a mode's menu label — no internal terminology in the UI. */
export function sidebarModeLabelKey(mode: SidebarMode): string {
  return `nav.sidebar.${mode}`;
}
