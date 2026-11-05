import type { ReactNode } from "react";
import { requireShowroomContext } from "@/features/showroom-shell/context";
import { ShowroomFrame } from "@/features/showroom-shell/frame";
import { isShowroomDealerOrg } from "@/features/showroom-shell/workspace-model";

export const dynamic = "force-dynamic";

/**
 * Access guard for the Showroom suite, plus the shell for every eligible type that is NOT a dealer.
 *
 * A `showroom_dealer` is already framed by the `(workspace)` layout above (so the shell survives moves
 * between /showroom and /b2b); drawing it again here would nest two shells. Supplier, Manufacturer, Importer
 * and Engineer organizations are framed only on this tree, exactly as before, so they keep their frame here.
 */
export default async function ShowroomLayout({ children }: { children: ReactNode }) {
  const { org } = await requireShowroomContext();
  return isShowroomDealerOrg(org.orgType) ? <>{children}</> : <ShowroomFrame>{children}</ShowroomFrame>;
}
