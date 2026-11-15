import "server-only";

import { headers } from "next/headers";
import { VIEW_AS_CONTEXT_HEADER, type ViewAsContext } from "./read-only-gate";
import { ViewAsReadOnlyError } from "./read-only-client";

/** The view tree this request belongs to, from the TRUSTED header the middleware sets (it strips any client copy). */
export async function currentViewAsContext(): Promise<ViewAsContext | null> {
  try {
    const v = (await headers()).get(VIEW_AS_CONTEXT_HEADER);
    return v === "exact" || v === "interim" ? v : v ? "interim" : null;
  } catch {
    return null; // outside a request scope
  }
}

/**
 * Call first in any Server Action / mutating route handler: refuses when the request was made from, or into, a view tree.
 * Second boundary behind the edge gate: a mutation is refused even if the gate were bypassed or misrouted.
 */
export async function assertNotViewAsContext(): Promise<void> {
  if (await currentViewAsContext()) throw new ViewAsReadOnlyError("action refused in a view-as context");
}
