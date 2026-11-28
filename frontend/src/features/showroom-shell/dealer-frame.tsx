import type { ReactNode } from "react";
import { loadRequestWorkspaceContext } from "@/server/queries/request-workspace";
import { ShowroomFrame } from "./frame";
import { isShowroomDealerOrg } from "./workspace-model";

/**
 * The Showroom shell, mounted ONCE ABOVE both of the routes a Showroom works in.
 *
 * WHY THIS EXISTS. A Showroom's sidebar lists V2 pages under `/showroom/*` and finished commerce modules
 * under `/b2b/*`. The two used to be separate route segments, each with its own layout that drew the same
 * shell, and Next only keeps a layout alive while the segment that owns it stays on screen: choosing a link
 * that crossed from one tree to the other unmounted the whole shell and built it again — the sidebar reset
 * (and with it its scroll position), the header and its menus remounted, and every query the frame runs was
 * repeated. Both trees now live under the `(workspace)` route group, whose layout is this component, so the
 * shell is one mounted instance and only `<main>` swaps. The route group adds no URL segment.
 *
 * Scope is deliberate: ONLY a `showroom_dealer` organization is framed here, because that is the one
 * organization type shown the same shell on both trees. Every other type keeps exactly what it had — the
 * workspace shell under `/b2b` (see the /b2b layout) and, for the types eligible for the Showroom suite, the
 * Showroom frame under `/showroom` (see the /showroom layout) — so no other account's UI changes. Those two
 * surfaces are different shells by design, which is why a switch between them is still a full swap.
 *
 * Callers without an active organization pass through untouched; the layout of the tree they asked for
 * decides what happens to them (the redirects and the account-safe notice live there).
 */
export async function ShowroomDealerFrame({ children }: { children: ReactNode }) {
  const { active } = await loadRequestWorkspaceContext();
  if (!isShowroomDealerOrg(active?.orgType ?? null)) return <>{children}</>;
  return <ShowroomFrame>{children}</ShowroomFrame>;
}
