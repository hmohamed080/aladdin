import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Read queries for the personal notification inbox.
 *
 * AUTHORITY IS `recipient_user_id`, AND IT IS ENFORCED IN THE DATABASE.
 * `public.notifications` carries exactly one RLS policy —
 * `recipient_user_id = auth.uid()` — and no org-wide read path at all
 * (`docs/database/notifications-core.md`, "RLS — recipient-only"). Every query
 * below therefore runs on the caller-scoped client and adds NO ownership filter
 * of its own: there is nothing to add that RLS has not already decided, and a
 * duplicated check in TypeScript would only be a second place to get it wrong.
 *
 * `organization_id` IS A UX FILTER AND NOTHING ELSE.
 * It records which workspace a notice belongs to so the B2B header can show the
 * work context the reader is actually in. Passing an org you do not belong to
 * cannot widen the result set — it can only narrow an already-RLS-bounded one to
 * zero rows. That is precisely why the specification forbids the column from
 * ever appearing in a `USING` clause, and why it appears here as an optional
 * argument rather than a required one.
 */

type DB = SupabaseClient<Database>;

export type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

/**
 * Bounded by construction. The header panel and the dashboard block are both
 * RECENT lists, not archives — there is no pagination in this increment and no
 * surface that wants row 200. A cap here means a runaway inbox degrades into a
 * shorter list rather than into a slow page.
 */
export const NOTIFICATION_LIST_LIMIT = 20;

export type ListNotificationsOptions = {
  /** UX scope only — see the module note. Omit for the whole personal inbox. */
  orgId?: string | null;
  limit?: number;
};

/**
 * The recent inbox, newest first.
 *
 * Recent-first is not a preference: a notification's value decays, and the row
 * a reader wants is almost always the one that just arrived. `created_at desc`
 * also matches both `ix_notifications_recipient_recent` and the partial unread
 * index, so the ordering is free.
 */
export async function listNotifications(
  supabase: DB,
  { orgId, limit = NOTIFICATION_LIST_LIMIT }: ListNotificationsOptions = {},
): Promise<NotificationRow[]> {
  let q = supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  // Scoped to the active workspace ONLY when there is one. The filter matches
  // `mark_all_notifications_read(p_org_id)` exactly, so what a reader sees, what
  // the badge counts and what "mark all read" clears are the same set of rows.
  if (orgId) q = q.eq("organization_id", orgId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/**
 * How many unread notices, WITHOUT transferring any of them.
 *
 * `head: true` sends no rows back — Postgres counts and returns the number in a
 * header. This read runs on every authenticated page render to decide whether
 * the header bell carries a badge, so fetching twenty rows to learn one integer
 * would be the most-repeated waste in the shell. `read_at is null` is the unread
 * predicate and is served by the partial index, which holds only unread rows and
 * so stays small permanently.
 */
export async function countUnread(
  supabase: DB,
  { orgId }: { orgId?: string | null } = {},
): Promise<number> {
  let q = supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .is("read_at", null);
  if (orgId) q = q.eq("organization_id", orgId);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}
