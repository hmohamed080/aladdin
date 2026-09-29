/**
 * The one hand-off between the shell's global header search and the Admin
 * Command Palette (Phase 0D final acceptance).
 *
 * There is ONE search entry point: the header field / Ctrl+K / Cmd+K. Inside
 * Admin Preview (and, once promoted, Admin) it opens the Admin palette instead
 * of the workspace search. No second trigger exists in the Admin content area,
 * and no search backend is involved — this only carries an "open / toggle"
 * intent from the header to the palette.
 */
export const ADMIN_PALETTE_EVENT = "aladdin:admin-palette";

export type AdminPaletteIntent = { mode: "open" | "toggle" };

/** Routes whose header search is the Admin palette. */
export function isAdminPaletteRoute(pathname: string): boolean {
  return pathname === "/admin/preview" || pathname.startsWith("/admin/preview/");
}

export function requestAdminPalette(mode: AdminPaletteIntent["mode"]): void {
  window.dispatchEvent(new CustomEvent<AdminPaletteIntent>(ADMIN_PALETTE_EVENT, { detail: { mode } }));
}
