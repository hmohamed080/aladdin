/**
 * Admin Core Phase 1B-A — URL search params → the exact arguments the
 * server-side directory RPCs accept (`admin_users_list`,
 * `admin_organizations_list`).
 *
 * The URL is user-editable, so every value is parsed against the closed set the
 * database accepts and anything else degrades to a safe default instead of
 * reaching the RPC (which would refuse it with 22023): a bad page becomes 1, a
 * bad page size becomes 10, a bad sort becomes the default, and an unknown
 * filter value is dropped (never reinterpreted as a different filter).
 */
import { clampPageSize, type PageSize } from "@/features/admin-preview/table-state";
import { GOVERNORATES } from "@/lib/onboarding/persona-fields";
import { Constants, type Database } from "@/types/database.types";

type Enums = Database["public"]["Enums"];
type Raw = string | string[] | undefined;

export const USER_STATUS_TABS = ["pending", "verified", "suspended", "rejected"] as const;
export const USER_VERIFICATION_STATES = ["unverified", "pending", "verified", "rejected"] as const;
export const USER_SORTS = ["registered:desc", "registered:asc", "completeness:desc", "completeness:asc"] as const;
export const ORG_STATUS_TABS = ["pending", "verified", "suspended"] as const;
export const ORG_SORTS = ["registered:desc", "registered:asc"] as const;

export type UserStatusTab = (typeof USER_STATUS_TABS)[number];
export type UserVerificationState = (typeof USER_VERIFICATION_STATES)[number];
export type UserSort = (typeof USER_SORTS)[number];
export type OrgStatusTab = (typeof ORG_STATUS_TABS)[number];
export type OrgSort = (typeof ORG_SORTS)[number];

/** The database's own search cap (22023 beyond it). */
export const SEARCH_MAX_LENGTH = 100;

export type UsersDirectoryParams = {
  search: string | null;
  status: UserStatusTab | null;
  accountType: Enums["persona_type"] | null;
  verification: UserVerificationState | null;
  governorate: string | null;
  sort: UserSort;
  page: number;
  pageSize: PageSize;
};

export type OrgsDirectoryParams = {
  search: string | null;
  status: OrgStatusTab | null;
  orgType: Enums["organization_type"] | null;
  sort: OrgSort;
  page: number;
  pageSize: PageSize;
};

function first(raw: Raw): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function oneOf<T extends string>(raw: Raw, allowed: readonly T[]): T | null {
  const value = first(raw);
  return value !== undefined && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export function parseSearch(raw: Raw): string | null {
  const value = first(raw)?.trim() ?? "";
  if (value === "") return null;
  return value.slice(0, SEARCH_MAX_LENGTH);
}

/** A positive integer page, else 1. The server clamps a too-high page to the last one. */
export function parsePage(raw: Raw): number {
  const value = first(raw);
  if (value === undefined || !/^\d+$/.test(value)) return 1;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 ? n : 1;
}

export function parseUsersDirectoryParams(sp: Record<string, Raw>): UsersDirectoryParams {
  return {
    search: parseSearch(sp.q),
    status: oneOf(sp.status, USER_STATUS_TABS),
    accountType: oneOf(sp.type, Constants.public.Enums.persona_type),
    verification: oneOf(sp.verification, USER_VERIFICATION_STATES),
    governorate: oneOf(sp.governorate, GOVERNORATES),
    sort: oneOf(sp.sort, USER_SORTS) ?? "registered:desc",
    page: parsePage(sp.page),
    pageSize: clampPageSize(first(sp.pageSize)),
  };
}

export function parseOrgsDirectoryParams(sp: Record<string, Raw>): OrgsDirectoryParams {
  return {
    search: parseSearch(sp.q),
    status: oneOf(sp.status, ORG_STATUS_TABS),
    orgType: oneOf(sp.type, Constants.public.Enums.organization_type),
    sort: oneOf(sp.sort, ORG_SORTS) ?? "registered:desc",
    page: parsePage(sp.page),
    pageSize: clampPageSize(first(sp.pageSize)),
  };
}

/** The `from`–`to` of `total` strip and page count the shared pagination footer renders. */
export function pageWindow(total: number, page: number, pageSize: number, rowsOnPage: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = rowsOnPage === 0 ? 0 : (page - 1) * pageSize + 1;
  return { page, totalPages, total, from, to: rowsOnPage === 0 ? 0 : from + rowsOnPage - 1 };
}
