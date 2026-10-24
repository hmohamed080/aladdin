/**
 * The B2C seller area lives inside the SAME Showroom workspace shell as /b2b:
 * same authentication, same derived organization / branch context, same
 * sidebar (where it is its own "الماركت — B2C" group, never part of B2B Sales).
 *
 * Re-exported rather than copied so the two route trees can never drift into two
 * workspaces. Access to each seller page is decided by that page on the server
 * (see `features/marketplace-seller/access`), not by this layout: a layout is not
 * re-rendered on every client navigation, a page is.
 */
export const dynamic = "force-dynamic";
export { default } from "@/app/b2b/layout";
