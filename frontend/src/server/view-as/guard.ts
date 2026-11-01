import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { isViewAsEnabled } from "@/lib/env/view-as";
import { can } from "@/lib/permissions/admin";
import { loadAdminAccess } from "@/server/authorization/admin";
import type { ViewAsKind } from "@/lib/admin/view-as/registry";

/**
 * The Admin View-As door (docs/admin/ADMIN_VIEW_AS_ARCHITECTURE.md §4.4, §5).
 *
 * EVERY page under /admin/users/[id]/view calls `requireViewAs`. A layout alone is not enough: Next does not re-run a
 * layout on a soft navigation between its child pages, so each page re-establishes the gate itself (the call is
 * memoized per request, so this costs nothing).
 *
 * This guard only READS the live session (`admin_view_as_current`); it never opens one. A session is opened only by the
 * deliberate same-origin POST to `/admin/users/[id]/view/start`, so a cross-site link, image or prefetch cannot make an
 * admin's browser start a session or write an `admin.view_as.started` audit row. The database stays the judge on every
 * read: `admin_view_as_current` re-checks the permission, the subject's eligibility and rank, and that the audited
 * 30-minute session is still live.
 *
 * Fail closed: feature switched off, malformed id or missing permission answer 404 (the route neither confirms nor
 * denies that the account exists). A subject that is ineligible, or a session that never started / has ended or expired,
 * returns the admin to the user's own admin page, where the eye starts a new one.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ViewAsContext = {
  sessionId: string;
  kind: ViewAsKind;
  subjectUserId: string;
  subjectName: string;
  startedAt: string;
  expiresAt: string;
};

/** Pure: interpret the `admin_view_as_begin` / `admin_view_as_current` payload. Anything unexpected is "no session". */
export function parseViewAsSession(raw: unknown): ViewAsContext | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
  const sessionId = str(r.session_id);
  const subjectUserId = str(r.subject_user_id);
  const startedAt = str(r.started_at);
  const expiresAt = str(r.expires_at);
  if (!sessionId || !subjectUserId || !startedAt || !expiresAt || r.kind !== "craftsman") return null;
  if (Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) return null;
  return {
    sessionId,
    kind: "craftsman",
    subjectUserId,
    subjectName: typeof r.subject_name === "string" ? r.subject_name : "",
    startedAt,
    expiresAt,
  };
}

export const requireViewAs = cache(async (subjectId: string): Promise<ViewAsContext> => {
  if (!isViewAsEnabled() || !UUID.test(subjectId)) notFound();
  const access = await loadAdminAccess();
  if (!access.isStaff || !can(access, "users.view_as")) notFound();

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("admin_view_as_current", { p_subject: subjectId, p_kind: "craftsman" });
  const session = error ? null : parseViewAsSession(data);
  if (!session || session.subjectUserId !== subjectId) redirect(`/admin/users/${subjectId}`);
  return session;
});
