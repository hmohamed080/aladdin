import "server-only";

import { cache } from "react";
import { notFound } from "next/navigation";
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
 * memoized per request, so this costs nothing). The database is the judge: `admin_view_as_begin` re-checks the
 * permission, the subject's eligibility and rank, opens (or reuses) the audited 30-minute session and returns it.
 *
 * Fail closed and non-disclosing: feature switched off, malformed id, missing permission, ineligible or unknown subject,
 * or any RPC error all end in the same 404 — the route neither confirms nor denies that the account exists.
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

/** Pure: interpret the `admin_view_as_begin` payload. Anything unexpected is "no session". */
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
  const { data, error } = await supabase.rpc("admin_view_as_begin", { p_subject: subjectId, p_kind: "craftsman" });
  if (error) notFound();
  const session = parseViewAsSession(data);
  if (!session || session.subjectUserId !== subjectId) notFound();
  return session;
});
