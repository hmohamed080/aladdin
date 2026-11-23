/**
 * Admin Core Phase 1B-A — typed read models for the Users / Organizations
 * directories and detail pages, mapped from the JSON the four read RPCs return
 * (`admin_users_list`, `admin_user_detail`, `admin_organizations_list`,
 * `admin_organization_detail`).
 *
 * Pure and fail-closed: a malformed row or nested element is dropped, never
 * guessed at, and a malformed envelope maps to `null` so the page shows its
 * error state instead of a partial table that looks complete.
 */
import type { UserStatusTab, UserVerificationState, OrgStatusTab } from "@/features/admin-preview/directory-params";

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean => v === true;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown): string[] => list(v).flatMap((x) => (typeof x === "string" ? [x] : []));

function pick<T extends object, K extends keyof T>(o: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = o[k];
  return out;
}

function mapAll<T>(v: unknown, map: (raw: unknown) => T | null): T[] {
  return list(v).flatMap((raw) => {
    const mapped = map(raw);
    return mapped ? [mapped] : [];
  });
}

export type LocalizedName = { name: string; nameAr: string | null; nameEn: string | null };

/** The name to show in `locale`: the locale-specific variant when present, else the canonical one. */
export function localizedName(n: LocalizedName, locale: string): string {
  return (locale === "ar" ? n.nameAr : n.nameEn) || n.name;
}

export type DirectoryPage<Row, Tab extends string> = {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<"all" | Tab, number>;
};

function mapPage<Row, Tab extends string>(
  raw: unknown,
  mapRow: (r: unknown) => Row | null,
  tabs: readonly Tab[],
): DirectoryPage<Row, Tab> | null {
  const o = obj(raw);
  const counts = obj(o?.counts);
  const total = num(o?.total);
  const page = num(o?.page);
  const pageSize = num(o?.page_size);
  if (!o || !counts || total === null || page === null || pageSize === null) return null;
  const tabCounts = { all: num(counts.all) ?? 0 } as Record<"all" | Tab, number>;
  for (const t of tabs) tabCounts[t] = num(counts[t]) ?? 0;
  return { rows: mapAll(o.rows, mapRow), total, page, pageSize, counts: tabCounts };
}

/* ------------------------------------------------------------------------ */
/* Users                                                                     */
/* ------------------------------------------------------------------------ */

export type UserFlag = "verification_issue";

export type AdminDirectoryUser = {
  id: string;
  displayName: LocalizedName;
  /** The account email, already stripped of the Installer login alias by the database. */
  email: string | null;
  /** Canonical E.164 phone. */
  phone: string | null;
  accountType: string | null;
  /** What the person registered as: their persona, else the business type they chose or belong to. */
  registeredAccount?: string | null;
  status: string;
  /** Derived sign-up progress (ADR-0031): unverified | consent_pending | account_type_pending | access_ready | active_personal | manually_blocked. Null from an older database. */
  registrationState?: string | null;
  isVerified: boolean;
  createdAt: string;
  verificationState: UserVerificationState;
  governorate: string | null;
  city: string | null;
  completion: number;
  organization: ({ id: string } & LocalizedName) | null;
  organizationCount: number;
  /** `profiles.id` — the key of `/p/[profileId]`, never the user id. */
  profileId: string | null;
  publicProfileAvailable: boolean;
  flags: UserFlag[];
};

const VERIFICATION_STATES: readonly UserVerificationState[] = ["unverified", "pending", "verified", "rejected"];

function verificationState(v: unknown): UserVerificationState {
  return (VERIFICATION_STATES as readonly unknown[]).includes(v) ? (v as UserVerificationState) : "unverified";
}

function displayNameOf(o: Obj): LocalizedName {
  return { name: str(o.display_name) ?? "", nameAr: str(o.display_name_ar), nameEn: str(o.display_name_en) };
}

/**
 * Phase 1 (account identity): the application username is no longer shown or
 * searchable. Until migration M3 the directory RPCs may still emit a legacy
 * `username` key (and `username` in `completion.missing`); both are ignored here.
 */
export function mapDirectoryUser(raw: unknown): AdminDirectoryUser | null {
  const o = obj(raw);
  const id = str(o?.id);
  const status = str(o?.status);
  const createdAt = str(o?.created_at);
  if (!o || !id || !status || !createdAt) return null;
  const org = obj(o.organization);
  const orgId = str(org?.id);
  return {
    id,
    displayName: displayNameOf(o),
    email: str(o.email),
    phone: str(o.phone),
    accountType: str(o.account_type),
    registeredAccount: str(o.registered_account),
    status,
    registrationState: str(o.registration_state),
    isVerified: bool(o.is_verified),
    createdAt,
    verificationState: verificationState(o.verification_state),
    governorate: str(o.governorate),
    city: str(o.city),
    completion: Math.min(100, Math.max(0, num(o.completion) ?? 0)),
    organization: org && orgId ? { id: orgId, name: str(org.name) ?? "", nameAr: str(org.name_ar), nameEn: str(org.name_en) } : null,
    organizationCount: num(o.organization_count) ?? 0,
    profileId: str(o.profile_id),
    publicProfileAvailable: bool(o.public_profile_available),
    flags: strings(o.flags).filter((f): f is UserFlag => f === "verification_issue"),
  };
}

export function mapUsersPage(raw: unknown): DirectoryPage<AdminDirectoryUser, UserStatusTab> | null {
  return mapPage(raw, mapDirectoryUser, ["pending", "verified", "suspended", "rejected", "attention"] as const);
}

export type AdminVerificationEvent = {
  /** `verification.admin_initiated` | `.review_started` | `.changes_requested` | `.approved` | `.rejected` */
  action: string;
  actorName: string | null;
  at: string;
};

export type AdminVerification = {
  id: string;
  verificationType: string;
  requestedAccountType: string | null;
  status: string;
  reason: string | null;
  submittedAt: string;
  decidedAt: string | null;
  /** Decision history from the immutable Audit Log, oldest first: who did what, and when. */
  events: AdminVerificationEvent[];
  /** The reviewing Admin; null while nobody has claimed the request. */
  reviewerName: string | null;
  /** The request was started by an Admin rather than submitted by the account owner. */
  initiatedByAdmin: boolean;
};

function mapVerificationEvent(raw: unknown): AdminVerificationEvent | null {
  const o = obj(raw);
  const action = str(o?.action);
  const at = str(o?.at);
  return o && action && at ? { action, actorName: str(o.actor_name), at } : null;
}

function mapVerification(raw: unknown): AdminVerification | null {
  const o = obj(raw);
  const id = str(o?.id);
  const submittedAt = str(o?.submitted_at);
  if (!o || !id || !submittedAt) return null;
  return {
    id,
    verificationType: str(o.verification_type) ?? "",
    requestedAccountType: str(o.requested_account_type),
    status: str(o.status) ?? "",
    reason: str(o.reason),
    submittedAt,
    decidedAt: str(o.decided_at),
    reviewerName: str(o.reviewer_name),
    initiatedByAdmin: o.initiated_by_admin === true,
    events: mapAll(o.events, mapVerificationEvent),
  };
}

export type AdminUserMembership = {
  membershipId: string;
  organization: { id: string } & LocalizedName;
  orgType: string;
  status: string;
  capabilities: string[];
};

export type AdminUserDetail = Omit<AdminDirectoryUser, "organization" | "organizationCount" | "flags" | "completion"> & {
  headline: string | null;
  bio: string | null;
  /** Supabase Auth's last successful sign-in — NOT product activity. */
  lastSignInAt: string | null;
  completion: { percent: number; missing: string[] };
  memberships: AdminUserMembership[];
  verifications: AdminVerification[];
};

export function mapUserDetail(raw: unknown): AdminUserDetail | null {
  const base = mapDirectoryUser(raw);
  const o = obj(raw);
  if (!base || !o) return null;
  const completion = obj(o.completion);
  return {
    ...pick(base, [
      "id", "displayName", "email", "phone", "accountType", "registeredAccount", "status", "isVerified", "createdAt",
      "verificationState", "governorate", "city", "profileId", "publicProfileAvailable",
    ] as const),
    headline: str(o.headline),
    bio: str(o.bio),
    lastSignInAt: str(o.last_sign_in_at),
    completion: {
      percent: Math.min(100, Math.max(0, num(completion?.percent) ?? 0)),
      missing: strings(completion?.missing).filter((key) => key !== "username"),
    },
    memberships: mapAll(o.memberships, (r) => {
      const m = obj(r);
      const membershipId = str(m?.membership_id);
      const orgId = str(m?.organization_id);
      if (!m || !membershipId || !orgId) return null;
      return {
        membershipId,
        organization: { id: orgId, name: str(m.organization_name) ?? "", nameAr: str(m.organization_name_ar), nameEn: str(m.organization_name_en) },
        orgType: str(m.org_type) ?? "",
        status: str(m.status) ?? "",
        capabilities: strings(m.capabilities),
      };
    }),
    verifications: mapAll(o.verifications, mapVerification),
  };
}

/* ------------------------------------------------------------------------ */
/* Organizations                                                             */
/* ------------------------------------------------------------------------ */

export type OrgVerificationState = "verified" | "pending" | "unverified";

/**
 * Organization APPROVAL (the decision on the organization application), separate from the LIFECYCLE `status`.
 * The database computes `approval_state` for the directory rows AND the detail page with the same expression
 * (20261116090001_admin_organizations_approval_state.sql) and the frontend REQUIRES it: a database without that migration yields a
 * safe error state (shape failure), never a guessed state. `organizationApprovalState` below is the mirror the tests use to pin the
 * SQL and the frontend rule to each other; it is not a runtime fallback.
 *   approved - is_verified or status = 'active'
 *   rejected - not approved and the latest ORGANIZATION request (type 'organization', newest submitted_at, created_at, id) is rejected
 *   pending  - not approved/rejected and a request is open (submitted / under_review / needs_more_info) or status = 'pending_verification'
 *   none     - everything else (draft, archived, an abandoned application whose latest request is cancelled, ...)
 */
export type OrgApprovalState = "approved" | "pending" | "rejected" | "none";
const ORG_APPROVAL_STATES: readonly string[] = ["approved", "pending", "rejected", "none"];
const OPEN_REQUEST = ["submitted", "under_review", "needs_more_info"];

export function organizationApprovalState(i: { isVerified: boolean; status: string; latestStatus: string | null }): OrgApprovalState {
  if (i.isVerified || i.status === "active") return "approved";
  if (i.latestStatus === "rejected") return "rejected";
  if ((i.latestStatus !== null && OPEN_REQUEST.includes(i.latestStatus)) || i.status === "pending_verification") return "pending";
  return "none";
}

/** The Organizations directory tab of one organization (null = listed under All only). Mirrors the SQL in 20261116090001. */
export function organizationDirectoryTab(i: { status: string; latestStatus: string | null }): OrgStatusTab | null {
  if (i.status === "suspended") return "suspended";
  if (i.status === "active") return "verified";
  if (i.status === "pending_verification") return i.latestStatus === "rejected" ? "rejected" : "pending";
  return null;
}

export type AdminPersonRef = { userId: string; displayName: string };

function mapPersonRef(raw: unknown): AdminPersonRef | null {
  const o = obj(raw);
  const userId = str(o?.user_id);
  return o && userId ? { userId, displayName: str(o.display_name) ?? "" } : null;
}

export type AdminDirectoryOrg = LocalizedName & {
  id: string;
  orgType: string;
  status: string;
  isVerified: boolean;
  verificationState: OrgVerificationState;
  /** The approval decision, never the lifecycle: see `organizationApprovalState`. */
  approvalState: OrgApprovalState;
  latestVerificationStatus: string | null;
  createdAt: string;
  source: string | null;
  memberCount: number;
  branchCount: number;
  owner: AdminPersonRef | null;
  /** The business phone and primary-branch location given at registration (and kept current in Settings). */
  contactPhone?: string | null;
  governorate?: string | null;
  city?: string | null;
  cityCustomName?: string | null;
};

export function mapDirectoryOrg(raw: unknown): AdminDirectoryOrg | null {
  const o = obj(raw);
  const id = str(o?.id);
  const status = str(o?.status);
  const createdAt = str(o?.created_at);
  if (!o || !id || !status || !createdAt) return null;
  const isVerified = bool(o.is_verified);
  const latestVerificationStatus = str(o.latest_verification_status);
  const sent = str(o.approval_state);
  if (!sent || !ORG_APPROVAL_STATES.includes(sent)) return null; // pre-migration database: refuse, do not guess
  return {
    id,
    name: str(o.name) ?? "",
    nameAr: str(o.name_ar),
    nameEn: str(o.name_en),
    orgType: str(o.org_type) ?? "",
    status,
    isVerified,
    verificationState: isVerified ? "verified" : status === "pending_verification" ? "pending" : "unverified",
    approvalState: sent as OrgApprovalState,
    latestVerificationStatus,
    createdAt,
    source: str(o.source),
    memberCount: num(o.member_count) ?? 0,
    branchCount: num(o.branch_count) ?? 0,
    owner: mapPersonRef(o.owner),
    contactPhone: str(o.contact_phone),
    governorate: str(o.governorate),
    city: str(o.city),
    cityCustomName: str(o.city_custom_name),
  };
}

export function mapOrgsPage(raw: unknown): DirectoryPage<AdminDirectoryOrg, OrgStatusTab> | null {
  // New-schema contract (20261116090001): counts.rejected and every row's approval_state must be present. Anything else is a
  // database that is behind this frontend; fail the shape check (safe error panel) instead of showing zeros or guessed states.
  const o = obj(raw);
  if (num(obj(o?.counts)?.rejected) === null) return null;
  const page = mapPage(raw, mapDirectoryOrg, ["pending", "verified", "suspended", "rejected"] as const);
  if (!page || page.rows.length !== list(o?.rows).length) return null;
  return page;
}

export type AdminOrgMember = AdminPersonRef & { membershipId: string; status: string; capabilities: string[] };
export type AdminOrgBranch = LocalizedName & { id: string; isActive: boolean };

export type AdminOrgDetail = Omit<AdminDirectoryOrg, "memberCount" | "branchCount" | "owner"> & {
  /** When the Verified badge was granted (business verification); approval alone leaves it null. */
  businessVerifiedAt: string | null;
  referredBy: AdminPersonRef | null;
  owners: AdminPersonRef[];
  members: AdminOrgMember[];
  branches: AdminOrgBranch[];
  verifications: AdminVerification[];
};

export function mapOrgDetail(raw: unknown): AdminOrgDetail | null {
  const base = mapDirectoryOrg(raw);
  const o = obj(raw);
  if (!base || !o) return null;
  return {
    ...pick(base, ["id", "name", "nameAr", "nameEn", "orgType", "status", "isVerified", "verificationState", "approvalState", "latestVerificationStatus", "createdAt", "source"] as const),
    businessVerifiedAt: str(o.business_verified_at),
    referredBy: mapPersonRef(o.referred_by),
    owners: mapAll(o.owners, mapPersonRef),
    members: mapAll(o.members, (r) => {
      const person = mapPersonRef(r);
      const m = obj(r);
      const membershipId = str(m?.membership_id);
      if (!person || !m || !membershipId) return null;
      return { ...person, membershipId, status: str(m.status) ?? "", capabilities: strings(m.capabilities) };
    }),
    branches: mapAll(o.branches, (r) => {
      const b = obj(r);
      const id = str(b?.id);
      if (!b || !id) return null;
      return { id, name: str(b.name) ?? "", nameAr: str(b.name_ar), nameEn: str(b.name_en), isActive: bool(b.is_active) };
    }),
    verifications: mapAll(o.verifications, mapVerification),
  };
}
