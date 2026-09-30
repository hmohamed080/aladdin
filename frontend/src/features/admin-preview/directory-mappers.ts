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
  username: string | null;
  /** The account email, already stripped of the Installer login alias by the database. */
  email: string | null;
  /** Canonical E.164 phone. */
  phone: string | null;
  accountType: string | null;
  status: string;
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
    username: str(o.username),
    email: str(o.email),
    phone: str(o.phone),
    accountType: str(o.account_type),
    status,
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
  return mapPage(raw, mapDirectoryUser, ["pending", "verified", "suspended", "rejected"] as const);
}

export type AdminVerification = {
  id: string;
  verificationType: string;
  requestedAccountType: string | null;
  status: string;
  reason: string | null;
  submittedAt: string;
  decidedAt: string | null;
};

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
      "id", "displayName", "username", "email", "phone", "accountType", "status", "isVerified", "createdAt",
      "verificationState", "governorate", "city", "profileId", "publicProfileAvailable",
    ] as const),
    headline: str(o.headline),
    bio: str(o.bio),
    lastSignInAt: str(o.last_sign_in_at),
    completion: {
      percent: Math.min(100, Math.max(0, num(completion?.percent) ?? 0)),
      missing: strings(completion?.missing),
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
  createdAt: string;
  source: string | null;
  memberCount: number;
  branchCount: number;
  owner: AdminPersonRef | null;
};

export function mapDirectoryOrg(raw: unknown): AdminDirectoryOrg | null {
  const o = obj(raw);
  const id = str(o?.id);
  const status = str(o?.status);
  const createdAt = str(o?.created_at);
  if (!o || !id || !status || !createdAt) return null;
  const isVerified = bool(o.is_verified);
  return {
    id,
    name: str(o.name) ?? "",
    nameAr: str(o.name_ar),
    nameEn: str(o.name_en),
    orgType: str(o.org_type) ?? "",
    status,
    isVerified,
    verificationState: isVerified ? "verified" : status === "pending_verification" ? "pending" : "unverified",
    createdAt,
    source: str(o.source),
    memberCount: num(o.member_count) ?? 0,
    branchCount: num(o.branch_count) ?? 0,
    owner: mapPersonRef(o.owner),
  };
}

export function mapOrgsPage(raw: unknown): DirectoryPage<AdminDirectoryOrg, OrgStatusTab> | null {
  return mapPage(raw, mapDirectoryOrg, ["pending", "verified", "suspended"] as const);
}

export type AdminOrgMember = AdminPersonRef & { membershipId: string; status: string; capabilities: string[] };
export type AdminOrgBranch = LocalizedName & { id: string; isActive: boolean };

export type AdminOrgDetail = Omit<AdminDirectoryOrg, "memberCount" | "branchCount" | "owner"> & {
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
    ...pick(base, ["id", "name", "nameAr", "nameEn", "orgType", "status", "isVerified", "verificationState", "createdAt", "source"] as const),
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
