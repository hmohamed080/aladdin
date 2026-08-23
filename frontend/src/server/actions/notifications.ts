"use server";

import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Read-state mutations for the personal notification inbox.
 *
 * Both forward the CALLER's JWT to a `security definer` RPC that re-derives the
 * actor from `auth.uid()`. Nothing is decided here: `public.notifications` has
 * NO write policy at all, so application code cannot update `read_at` directly
 * even if it tried. Marking someone else's notice read raises `42501` in the
 * database, not in TypeScript.
 *
 * BOTH CALLS ARE IDEMPOTENT BY CONSTRUCTION.
 * `mark_notification_read` sets `read_at` only where it is still null, so a
 * double click, a retried request and a row that was already read all converge
 * on the same state. That is what makes it safe to fire optimistically from a
 * row the reader is simultaneously navigating away from — the outcome does not
 * depend on whether the response ever arrives.
 *
 * WHY THERE IS NO `revalidatePath` HERE
 * The notification surfaces are the header panel (rendered in the shared LAYOUT,
 * on every authenticated route) and the supply dashboard block. A
 * `revalidatePath("/b2b", "layout")` broad enough to catch the header would
 * expire the entire B2B subtree for a change that affects one badge. The caller
 * instead invokes `router.refresh()`, which re-fetches exactly the route the
 * reader is on plus its layouts — the header badge and any visible list update
 * together, nothing else is touched, and there is no full browser reload.
 */
export type NotificationReadState = { ok: boolean; code?: string };

/** Marks one notice read. `id` must be the row's own uuid. */
export async function markNotificationReadAction(id: string): Promise<NotificationReadState> {
  if (!id) return { ok: false, code: "states.genericRetry" };

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("mark_notification_read", { p_id: id });
  if (error) return { ok: false, code: "states.genericRetry" };
  return { ok: true };
}

/**
 * Marks every unread notice read, narrowed to one workspace when supplied.
 *
 * The scope argument is not optional detail. "Clear all" pressed inside a
 * business context must not silently clear personal notices the reader has never
 * seen, so the caller passes the org whose list it is actually showing — the
 * same value `listNotifications` filtered on, so the button clears exactly the
 * rows on screen and no others.
 */
export async function markAllNotificationsReadAction(
  orgId?: string | null,
): Promise<NotificationReadState> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("mark_all_notifications_read", {
    p_org_id: orgId ?? undefined,
  });
  if (error) return { ok: false, code: "states.genericRetry" };
  return { ok: true };
}
