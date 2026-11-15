import type { NextRequest } from "next/server";
import { POST as startInterim } from "@/app/admin/users/[id]/view/start/route";

export const dynamic = "force-dynamic";

/**
 * Open the audited session (same handler, same origin checks, same RPC as the interim start) and land on the EXACT view.
 * Only the redirect target differs: `/view-as/[id]` instead of `/admin/users/[id]/view`.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const res = await startInterim(request, ctx);
  const location = res.headers.get("location");
  if (res.status === 303 && location) {
    const { id } = await ctx.params;
    res.headers.set("location", new URL(`/view-as/${id}`, location).toString());
  }
  return res;
}
