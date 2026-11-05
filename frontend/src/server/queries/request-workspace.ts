import "server-only";

import { cache } from "react";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaceContext } from "@/server/queries/context";

/**
 * The caller's work context, read ONCE per request.
 *
 * Next renders a route's layouts and its page in the same request, and each of them used to call
 * `loadWorkspaceContext` for itself: the workspace frame, the /b2b guard, the Showroom guard and the
 * Showroom frame's own context check all repeated the same membership / capability / branch reads.
 * `cache()` makes that exact "once per request" — it is NOT a data cache and nothing survives the response,
 * so a workspace switch or a membership change is seen by the very next request (see `getServerSupabase`,
 * which is memoised per request the same way and is what gives every caller the one client).
 *
 * Read-only render paths only. A Server Action that changes membership and then re-reads must keep calling
 * `loadWorkspaceContext` directly so it never sees its own stale answer.
 */
export const loadRequestWorkspaceContext = cache(async () => loadWorkspaceContext(await getServerSupabase()));
