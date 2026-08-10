import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Read-models for the Admin console. Every query runs as the caller — a platform
 * staff member — so RLS (the `is_platform(...)` policies on users / organizations
 * / verifications / audit_log / memberships) is what actually returns the
 * cross-tenant rows. An ordinary caller reading these would simply get nothing;
 * the admin route guard is defense in depth, not the security boundary.
 */

type Client = SupabaseClient<Database>;

export type AdminSummary = {
  usersByStatus: Record<string, number>;
  usersByType: Record<string, number>;
  orgsByStatus: Record<string, number>;
  orgsVerified: number;
  orgsTotal: number;
  pendingVerifications: number;
  recentAudit: AuditEntry[];
};

export type AdminUserRow = {
  id: string;
  displayName: string;
  accountType: string;
  status: string;
  isVerified: boolean;
  createdAt: string;
};

export type AdminOrgRow = {
  id: string;
  name: string;
  orgType: string;
  status: string;
  isVerified: boolean;
  memberCount: number;
  createdAt: string;
};

export type VerificationRow = {
  id: string;
  subjectType: "user" | "organization";
  subjectName: string;
  verificationType: string;
  requestedAccountType: string | null;
  status: string;
  reason: string | null;
  submittedAt: string;
  decidedAt: string | null;
};

export type AuditEntry = {
  id: string;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  subjectType: string;
  subjectId: string | null;
  createdAt: string;
};

function tally(rows: { k: string | null }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { k } of rows) {
    const key = k ?? "unknown";
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/** Resolve display names for a mixed set of user + org subject ids. */
async function resolveSubjectNames(
  supabase: Client,
  userIds: string[],
  orgIds: string[],
): Promise<{ users: Map<string, string>; orgs: Map<string, string> }> {
  const users = new Map<string, string>();
  const orgs = new Map<string, string>();
  if (userIds.length) {
    const { data } = await supabase.from("profiles").select("user_id, display_name").in("user_id", userIds);
    for (const r of data ?? []) users.set(r.user_id, r.display_name);
  }
  if (orgIds.length) {
    const { data } = await supabase.from("organizations").select("id, name").in("id", orgIds);
    for (const r of data ?? []) orgs.set(r.id, r.name);
  }
  return { users, orgs };
}

export async function adminSummary(supabase: Client): Promise<AdminSummary> {
  const [usersRes, orgsRes, verRes] = await Promise.all([
    supabase.from("users").select("status, primary_account_type"),
    supabase.from("organizations").select("status, is_verified"),
    supabase.from("verifications").select("status"),
  ]);

  const users = usersRes.data ?? [];
  const orgs = orgsRes.data ?? [];
  const vers = verRes.data ?? [];

  return {
    usersByStatus: tally(users.map((u) => ({ k: u.status }))),
    usersByType: tally(users.map((u) => ({ k: u.primary_account_type }))),
    orgsByStatus: tally(orgs.map((o) => ({ k: o.status }))),
    orgsVerified: orgs.filter((o) => o.is_verified).length,
    orgsTotal: orgs.length,
    pendingVerifications: vers.filter((v) => v.status === "submitted" || v.status === "under_review").length,
    recentAudit: await listAudit(supabase, 8),
  };
}

export async function listUsers(supabase: Client, search?: string): Promise<AdminUserRow[]> {
  const { data, error } = await supabase
    .from("users")
    .select("id, primary_account_type, status, is_verified, created_at, profiles(display_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const rows = (data ?? []).map((u) => ({
    id: u.id,
    displayName: (u.profiles as { display_name: string } | null)?.display_name ?? "",
    accountType: u.primary_account_type,
    status: u.status,
    isVerified: u.is_verified,
    createdAt: u.created_at,
  }));
  if (!search) return rows;
  const q = search.toLowerCase();
  return rows.filter(
    (r) => r.displayName.toLowerCase().includes(q) || r.accountType.toLowerCase().includes(q),
  );
}

export type AdminUserDetail = {
  id: string;
  displayName: string;
  headline: string | null;
  accountType: string;
  status: string;
  isVerified: boolean;
  createdAt: string;
  memberships: {
    membershipId: string;
    orgId: string;
    orgName: string;
    status: string;
    capabilities: string[];
  }[];
  verifications: VerificationRow[];
};

export async function getUserDetail(supabase: Client, userId: string): Promise<AdminUserDetail | null> {
  const { data: user } = await supabase
    .from("users")
    .select("id, primary_account_type, status, is_verified, created_at, profiles(display_name, headline)")
    .eq("id", userId)
    .maybeSingle();
  if (!user) return null;

  const { data: memberships } = await supabase
    .from("memberships")
    .select("id, status, organization_id, organizations(name), membership_capabilities(capability_key)")
    .eq("user_id", userId);

  const { data: vers } = await supabase
    .from("verifications")
    .select(
      "id, subject_type, verification_type, requested_account_type, status, reason, submitted_at, decided_at",
    )
    .eq("user_id", userId)
    .order("submitted_at", { ascending: false });

  const profile = user.profiles as { display_name: string; headline: string | null } | null;
  return {
    id: user.id,
    displayName: profile?.display_name ?? "",
    headline: profile?.headline ?? null,
    accountType: user.primary_account_type,
    status: user.status,
    isVerified: user.is_verified,
    createdAt: user.created_at,
    memberships: (memberships ?? []).map((m) => ({
      membershipId: m.id,
      orgId: m.organization_id,
      orgName: (m.organizations as { name: string } | null)?.name ?? "",
      status: m.status,
      capabilities: ((m.membership_capabilities as { capability_key: string }[]) ?? []).map(
        (c) => c.capability_key,
      ),
    })),
    verifications: (vers ?? []).map((v) => ({
      id: v.id,
      subjectType: v.subject_type,
      subjectName: profile?.display_name ?? "",
      verificationType: v.verification_type,
      requestedAccountType: v.requested_account_type,
      status: v.status,
      reason: v.reason,
      submittedAt: v.submitted_at,
      decidedAt: v.decided_at,
    })),
  };
}

export async function listOrganizations(supabase: Client): Promise<AdminOrgRow[]> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, org_type, status, is_verified, created_at, memberships(count)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []).map((o) => ({
    id: o.id,
    name: o.name,
    orgType: o.org_type,
    status: o.status,
    isVerified: o.is_verified,
    memberCount: (o.memberships as { count: number }[] | null)?.[0]?.count ?? 0,
    createdAt: o.created_at,
  }));
}

export type AdminOrgDetail = {
  id: string;
  name: string;
  orgType: string;
  status: string;
  isVerified: boolean;
  createdAt: string;
  branches: { id: string; name: string; isActive: boolean }[];
  members: { membershipId: string; userId: string; displayName: string; status: string }[];
  verifications: VerificationRow[];
};

export async function getOrganizationDetail(
  supabase: Client,
  orgId: string,
): Promise<AdminOrgDetail | null> {
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, org_type, status, is_verified, created_at")
    .eq("id", orgId)
    .maybeSingle();
  if (!org) return null;

  const [{ data: branches }, { data: members }, { data: vers }] = await Promise.all([
    supabase.from("branches").select("id, name, is_active").eq("organization_id", orgId).is("deleted_at", null),
    supabase.from("memberships").select("id, user_id, status").eq("organization_id", orgId),
    supabase
      .from("verifications")
      .select("id, subject_type, verification_type, requested_account_type, status, reason, submitted_at, decided_at")
      .eq("organization_id", orgId)
      .order("submitted_at", { ascending: false }),
  ]);

  const memberRows = members ?? [];
  const { users: memberNames } = await resolveSubjectNames(
    supabase,
    memberRows.map((m) => m.user_id),
    [],
  );

  return {
    id: org.id,
    name: org.name,
    orgType: org.org_type,
    status: org.status,
    isVerified: org.is_verified,
    createdAt: org.created_at,
    branches: (branches ?? []).map((b) => ({ id: b.id, name: b.name, isActive: b.is_active })),
    members: memberRows.map((m) => ({
      membershipId: m.id,
      userId: m.user_id,
      displayName: memberNames.get(m.user_id) ?? "",
      status: m.status,
    })),
    verifications: (vers ?? []).map((v) => ({
      id: v.id,
      subjectType: v.subject_type,
      subjectName: org.name,
      verificationType: v.verification_type,
      requestedAccountType: v.requested_account_type,
      status: v.status,
      reason: v.reason,
      submittedAt: v.submitted_at,
      decidedAt: v.decided_at,
    })),
  };
}

export async function listVerifications(
  supabase: Client,
  pendingOnly: boolean,
): Promise<VerificationRow[]> {
  let query = supabase
    .from("verifications")
    .select(
      "id, subject_type, user_id, organization_id, verification_type, requested_account_type, status, reason, submitted_at, decided_at",
    )
    .order("submitted_at", { ascending: false })
    .limit(200);
  if (pendingOnly) query = query.in("status", ["submitted", "under_review"]);

  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];
  const { users, orgs } = await resolveSubjectNames(
    supabase,
    rows.filter((r) => r.user_id).map((r) => r.user_id as string),
    rows.filter((r) => r.organization_id).map((r) => r.organization_id as string),
  );
  return rows.map((v) => ({
    id: v.id,
    subjectType: v.subject_type,
    subjectName:
      v.subject_type === "user"
        ? users.get(v.user_id as string) ?? ""
        : orgs.get(v.organization_id as string) ?? "",
    verificationType: v.verification_type,
    requestedAccountType: v.requested_account_type,
    status: v.status,
    reason: v.reason,
    submittedAt: v.submitted_at,
    decidedAt: v.decided_at,
  }));
}

export async function listAudit(supabase: Client, limit = 40): Promise<AuditEntry[]> {
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, actor_user_id, actor_role, action, subject_type, subject_id, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = data ?? [];
  const { users } = await resolveSubjectNames(
    supabase,
    rows.filter((r) => r.actor_user_id).map((r) => r.actor_user_id as string),
    [],
  );
  return rows.map((a) => ({
    id: a.id,
    actorName: a.actor_user_id ? users.get(a.actor_user_id) ?? null : null,
    actorRole: a.actor_role,
    action: a.action,
    subjectType: a.subject_type,
    subjectId: a.subject_id,
    createdAt: a.created_at,
  }));
}
