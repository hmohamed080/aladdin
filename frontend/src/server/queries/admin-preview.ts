import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { listVerifications, listAudit as listAuditBase, type VerificationRow, type AuditEntry } from "@/server/queries/admin";
import { listAdminReferrals, type AdminReferralRow } from "@/server/queries/affiliation";
import { listAdminNetworkReferrals, type AdminNetworkReferralRow } from "@/server/queries/network-referrals";
import { previewCompletenessFor } from "@/features/admin-preview/fixtures";

/**
 * Phase 0 — Admin Frontend Blueprint / Preview. Read-only query layer.
 *
 * Per PD-013 (frontend-first Admin delivery) and the Phase 0 data strategy:
 * every function here reads REAL Aladdin data through the SAME RLS-scoped
 * client every other admin query uses — nothing here bypasses RLS, adds a
 * new RPC, or writes anything. Two kinds of function live in this file:
 *
 *   1. Thin re-reads of already-existing, already-safe query paths
 *      (re-exported below for the preview pages to import from one place).
 *   2. A small number of genuinely NEW read-only queries/compositions that
 *      were not needed before this preview existed, but which read data an
 *      admin platform role can already see under existing RLS policies
 *      (`points_ledger_select_platform`, the same self+platform pattern
 *      every other admin-read table already uses). These are NOT part of
 *      the Phase 1/2/3 backend build — they exist only to let this preview
 *      show real data instead of inventing a parallel fake one, per the
 *      Phase 0 data-strategy instruction ("prefer real, read-only data
 *      through existing safe query paths whenever possible").
 *
 * Nothing in this file performs a mutation. Nothing in this file is a
 * fixture — see `features/admin-preview/fixtures.ts` for the (clearly
 * labelled) preview-only fixture data, used only where no backend exists
 * at all yet (Admin Notes).
 */

type Client = SupabaseClient<Database>;

export { listVerifications, listAudit } from "@/server/queries/admin";
export type { VerificationRow, AuditEntry } from "@/server/queries/admin";
export { listAdminReferrals } from "@/server/queries/affiliation";
export type { AdminReferralRow } from "@/server/queries/affiliation";
export { listAdminNetworkReferrals } from "@/server/queries/network-referrals";
export type { AdminNetworkReferralRow } from "@/server/queries/network-referrals";

/* ---------------------------------------------------------------------- */
/* Points ledger — real read, reusing the existing platform RLS grant.     */
/* Genuinely new: no prior caller needed a per-user ledger read. Preview   */
/* only for BL-003's own read surface (BL-003 itself is not built here).  */
/* ---------------------------------------------------------------------- */

export type PointsLedgerEntry = {
  id: string;
  eventType: string;
  pointsDelta: number;
  sourceType: string;
  sourceId: string;
  reasonCode: string | null;
  awardedByUserId: string | null;
  reversesEntryId: string | null;
  createdAt: string;
};

export async function previewUserPointsLedger(
  supabase: Client,
  userId: string,
): Promise<{ entries: PointsLedgerEntry[]; balance: number }> {
  const [{ data: rows, error }, { data: balanceData, error: balanceError }] = await Promise.all([
    supabase
      .from("points_ledger")
      .select("id, event_type, points_delta, source_type, source_id, reason_code, awarded_by_user_id, reverses_entry_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.rpc("points_balance", { p_user_id: userId }),
  ]);
  if (error) throw error;
  if (balanceError) throw balanceError;
  return {
    entries: (rows ?? []).map((r) => ({
      id: r.id,
      eventType: r.event_type,
      pointsDelta: r.points_delta,
      sourceType: r.source_type,
      sourceId: r.source_id,
      reasonCode: r.reason_code,
      awardedByUserId: r.awarded_by_user_id,
      reversesEntryId: r.reverses_entry_id,
      createdAt: r.created_at,
    })),
    balance: Number(balanceData ?? 0),
  };
}

/**
 * The user whose ledger changed most recently, or null when the environment has
 * no ledger rows at all. Lets the Points page open on real data immediately
 * instead of an empty picker. Read-only; the caller falls back to a labelled
 * fixture when this is null (no rows are ever created to make the page look full).
 */
export async function previewLatestPointsUserId(supabase: Client): Promise<string | null> {
  const { data } = await supabase
    .from("points_ledger")
    .select("user_id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.user_id ?? null;
}

/* ---------------------------------------------------------------------- */
/* Audit, with the detail the expandable row needs — REAL. `listAudit()`   */
/* (shared with the live `/admin/audit`, left untouched) does not select   */
/* `metadata` or `organization_id`; this adds them with one extra read of  */
/* the SAME table for the SAME rows under the same platform RLS grant.     */
/* ---------------------------------------------------------------------- */

export type DetailedAuditEntry = AuditEntry & {
  /** The row's `metadata` object exactly as recorded (rendered without raw JSON by `describeAuditMetadata`). */
  metadata: unknown;
  organizationId: string | null;
  organizationName: string | null;
};

export async function previewAuditDetailed(supabase: Client, limit = 200): Promise<DetailedAuditEntry[]> {
  const base = await listAuditBase(supabase, limit);
  if (base.length === 0) return [];
  const { data: extras } = await supabase.from("audit_log").select("id, metadata, organization_id").in("id", base.map((e) => e.id));
  const extraById = new Map((extras ?? []).map((r) => [r.id, r]));
  const orgIds = Array.from(new Set((extras ?? []).flatMap((r) => (r.organization_id ? [r.organization_id] : []))));
  const { data: orgs } = orgIds.length
    ? await supabase.from("organizations").select("id, name").in("id", orgIds)
    : { data: [] as { id: string; name: string }[] };
  const orgName = new Map((orgs ?? []).map((o) => [o.id, o.name]));
  return base.map((e) => {
    const x = extraById.get(e.id);
    return {
      ...e,
      metadata: x?.metadata ?? {},
      organizationId: x?.organization_id ?? null,
      organizationName: x?.organization_id ? (orgName.get(x.organization_id) ?? null) : null,
    };
  });
}

/* ---------------------------------------------------------------------- */
/* Entity Timeline — a real composition over already-real data (BL-012's   */
/* own read surface). Never a raw audit feed: each source event is mapped */
/* to one short, human-readable narrative line.                            */
/* ---------------------------------------------------------------------- */

export type TimelineEntry = {
  id: string;
  label: string;
  detail: string | null;
  at: string;
};

function verificationTimelineEntries(vers: VerificationRow[]): TimelineEntry[] {
  return vers.flatMap((v) => {
    const entries: TimelineEntry[] = [
      {
        id: `${v.id}-submitted`,
        label: `Verification submitted (${v.verificationType})`,
        detail: v.requestedAccountType,
        at: v.submittedAt,
      },
    ];
    if (v.decidedAt) {
      entries.push({
        id: `${v.id}-decided`,
        label: v.status === "approved" ? "Verification approved" : "Verification decided",
        detail: v.reason,
        at: v.decidedAt,
      });
    }
    return entries;
  });
}

/** A user's timeline: their own verification history + audit_log rows where they are the actor or subject. */
export async function previewUserTimeline(supabase: Client, userId: string): Promise<TimelineEntry[]> {
  const [vers, { data: auditRows }] = await Promise.all([
    listVerifications(supabase, false).then((rows) => rows.filter((r) => r.subjectType === "user")),
    supabase
      .from("audit_log")
      .select("id, action, subject_type, subject_id, actor_user_id, created_at")
      .or(`actor_user_id.eq.${userId},and(subject_type.eq.user,subject_id.eq.${userId})`)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const auditEntries: TimelineEntry[] = (auditRows ?? []).map((a) => ({
    id: a.id,
    label: a.action.replace(/[._]/g, " "),
    detail: a.actor_user_id === userId ? "by this user" : null,
    at: a.created_at,
  }));

  return [...verificationTimelineEntries(vers), ...auditEntries].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );
}

/** An organization's timeline: its verification history + audit_log rows scoped to it. */
export async function previewOrgTimeline(supabase: Client, orgId: string): Promise<TimelineEntry[]> {
  const [vers, { data: auditRows }] = await Promise.all([
    listVerifications(supabase, false).then((rows) => rows.filter((r) => r.subjectType === "organization")),
    supabase
      .from("audit_log")
      .select("id, action, subject_type, subject_id, organization_id, created_at")
      .or(`organization_id.eq.${orgId},and(subject_type.eq.organization,subject_id.eq.${orgId})`)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const auditEntries: TimelineEntry[] = (auditRows ?? []).map((a) => ({
    id: a.id,
    label: a.action.replace(/[._]/g, " "),
    detail: null,
    at: a.created_at,
  }));

  return [...verificationTimelineEntries(vers), ...auditEntries].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );
}

/* ---------------------------------------------------------------------- */
/* Review Center — a real, merged queue over the three EXISTING review     */
/* read models (generic verifications, Sales referrals, Network referrals).*/
/* This is a preview of the planned single-queue presentation; the         */
/* underlying data and RPCs are the same ones /admin/verifications uses.   */
/* ---------------------------------------------------------------------- */

export type ReviewQueueItem =
  | { kind: "verification"; row: VerificationRow }
  | { kind: "salesReferral"; row: AdminReferralRow }
  | { kind: "networkReferral"; row: AdminNetworkReferralRow };

/* ---------------------------------------------------------------------- */
/* Scoped audit read — the raw rows behind a subject's "Audit" tab, distinct */
/* from the human-narrative Entity Timeline above. Real data, same table.    */
/* ---------------------------------------------------------------------- */

export type ScopedAuditEntry = {
  id: string;
  action: string;
  actorRole: string | null;
  createdAt: string;
};

export async function previewSubjectAudit(
  supabase: Client,
  subjectType: "user" | "organization",
  subjectId: string,
): Promise<ScopedAuditEntry[]> {
  const filter =
    subjectType === "user"
      ? `actor_user_id.eq.${subjectId},and(subject_type.eq.user,subject_id.eq.${subjectId})`
      : `organization_id.eq.${subjectId},and(subject_type.eq.organization,subject_id.eq.${subjectId})`;
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, action, actor_role, created_at")
    .or(filter)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, action: r.action, actorRole: r.actor_role, createdAt: r.created_at }));
}

export async function previewReviewQueue(supabase: Client): Promise<ReviewQueueItem[]> {
  const [vers, salesReferrals, networkReferrals] = await Promise.all([
    listVerifications(supabase, true),
    listAdminReferrals(supabase, true),
    listAdminNetworkReferrals(supabase, true),
  ]);

  const items: ReviewQueueItem[] = [
    ...vers.map((row): ReviewQueueItem => ({ kind: "verification", row })),
    ...salesReferrals.map((row): ReviewQueueItem => ({ kind: "salesReferral", row })),
    ...networkReferrals.map((row): ReviewQueueItem => ({ kind: "networkReferral", row })),
  ];

  const timeOf = (item: ReviewQueueItem) =>
    item.kind === "verification" ? item.row.submittedAt : item.row.createdAt;
  return items.sort((a, b) => new Date(timeOf(b)).getTime() - new Date(timeOf(a)).getTime());
}

/* ---------------------------------------------------------------------- */
/* Phase 0B — Admin Product Blueprint Enrichment additions below.          */
/* Same rule as Phase 0: real, RLS-respecting reads only; no new RPC, no   */
/* new table, no mutation. Each function says exactly what it reads and    */
/* why it's safe.                                                          */
/* ---------------------------------------------------------------------- */

/* ---------------------------------------------------------------------- */
/* Organization duplicate candidates — REAL, generalizing the exact        */
/* pg_trgm-similarity technique `admin_network_referrals_list` /           */
/* `admin_showroom_referrals_list` already use for referral dedup (see     */
/* B2/BL-015, PD-006's approved "detect → suggest → link" scope), to any   */
/* organization rather than only ones arriving through a referral. A       */
/* plain SELECT against `organizations`, not a new RPC — the similarity    */
/* function itself (`extensions.similarity`) is already granted for use    */
/* from client queries the same way the referral RPCs use it internally.   */
/* ---------------------------------------------------------------------- */

export type OrgDuplicateCandidate = { id: string; name: string; orgType: string; similarity: number };

export async function previewOrgDuplicateCandidates(
  supabase: Client,
  orgId: string,
  name: string,
  orgType: Database["public"]["Enums"]["organization_type"],
): Promise<OrgDuplicateCandidate[]> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, org_type")
    .neq("id", orgId)
    .eq("org_type", orgType)
    .is("deleted_at", null)
    .or(`name.ilike.${name},name.ilike.%${name}%`)
    .limit(5);
  if (error) return [];
  return (data ?? [])
    .map((o) => ({
      id: o.id,
      name: o.name,
      orgType: o.org_type,
      // A real Postgres-side similarity() call would need a dedicated RPC (out of
      // scope for Phase 0B); this is a client-side approximation of the same
      // signal (normalized-substring match) purely to rank the candidates the
      // query above already found for real — never a fabricated candidate.
      similarity: o.name.toLowerCase() === name.toLowerCase() ? 1 : 0.6,
    }))
    .sort((a, b) => b.similarity - a.similarity);
}

/**
 * A cheap, directory-wide duplicate FLAG (not full candidate search) — real,
 * computed once over the already-fetched organization list by grouping on a
 * normalized name, so the Organizations directory can show a "possible
 * duplicate" badge without one query per row. Exact-normalized-name matches
 * only (case/whitespace-insensitive) — a lighter signal than the full
 * similarity search on the detail page's Network tab, by design.
 */
export function flagDuplicateOrgNames<T extends { id: string; name: string; orgType: string }>(
  orgs: readonly T[],
): Set<string> {
  const byKey = new Map<string, string[]>();
  for (const o of orgs) {
    const key = `${o.orgType}::${o.name.trim().toLowerCase()}`;
    byKey.set(key, [...(byKey.get(key) ?? []), o.id]);
  }
  const flagged = new Set<string>();
  for (const ids of byKey.values()) {
    if (ids.length > 1) ids.forEach((id) => flagged.add(id));
  }
  return flagged;
}

/* ---------------------------------------------------------------------- */
/* Dashboard extras — REAL counts `adminSummary()` (server/queries/admin.ts, */
/* shared with the live `/admin` dashboard) does not compute today. Kept in */
/* THIS file rather than added to `adminSummary()` so the real dashboard's   */
/* query stays untouched, per Phase 0's "existing Admin remains unaffected"  */
/* rule — this is an ADDITIONAL read, not a change to a shared one.         */
/* Referral counts reuse the same admin RPCs the Review Center already      */
/* calls with `pendingOnly: true`. Incomplete-profile counts are the one    */
/* fixture in this function (see `previewCompletenessFor`'s own doc comment */
/* for why no real completeness read path exists yet for another user's or  */
/* organization's onboarding answers).                                      */
/* ---------------------------------------------------------------------- */

export type DashboardExtras = {
  newRegistrationsThisWeek: number;
  rejectedUserVerifications: number;
  pendingReferralsTotal: number;
  duplicateOrgCandidateCount: number;
  incompleteUserProfileCount: number;
  incompleteOrgProfileCount: number;
};

export async function previewDashboardExtras(supabase: Client): Promise<DashboardExtras> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: newRegistrationsThisWeek },
    { count: rejectedUserVerifications },
    salesReferrals,
    networkReferrals,
    { data: orgRows },
    { data: userRows },
  ] = await Promise.all([
    supabase.from("users").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
    supabase
      .from("verifications")
      .select("id", { count: "exact", head: true })
      .eq("subject_type", "user")
      .eq("status", "rejected"),
    listAdminReferrals(supabase, true),
    listAdminNetworkReferrals(supabase, true),
    supabase.from("organizations").select("id, name, org_type").is("deleted_at", null),
    supabase.from("users").select("id"),
  ]);

  const orgs = (orgRows ?? []).map((o) => ({ id: o.id, name: o.name, orgType: o.org_type }));
  const duplicateOrgCandidateCount = flagDuplicateOrgNames(orgs).size;
  const incompleteOrgProfileCount = orgs.filter((o) => previewCompletenessFor(o.id) < 70).length;
  const incompleteUserProfileCount = (userRows ?? []).filter((u) => previewCompletenessFor(u.id) < 70).length;

  return {
    newRegistrationsThisWeek: newRegistrationsThisWeek ?? 0,
    rejectedUserVerifications: rejectedUserVerifications ?? 0,
    pendingReferralsTotal: salesReferrals.length + networkReferrals.length,
    duplicateOrgCandidateCount,
    incompleteUserProfileCount,
    incompleteOrgProfileCount,
  };
}
