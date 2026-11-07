import type { ReactNode } from "react";
import { ShowroomDealerFrame } from "@/features/showroom-shell/dealer-frame";

export const dynamic = "force-dynamic";

/**
 * `(workspace)` is a route group: it adds no URL segment, it only gives `/b2b/*` and `/showroom/*` one shared
 * layout so the Showroom shell stays mounted while a Showroom moves between them. See `ShowroomDealerFrame`.
 */
export default function WorkspaceGroupLayout({ children }: { children: ReactNode }) {
  return <ShowroomDealerFrame>{children}</ShowroomDealerFrame>;
}
