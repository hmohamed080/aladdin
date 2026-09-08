import { DASHBOARD_TIMEZONE_FALLBACK } from "@/lib/workspace/dashboard-period";

/**
 * The approved timezone resolution order: active branch, then organization,
 * then a hardcoded fallback for records that have never set one. Pure and
 * synchronous — the branch/org values are already loaded by the caller
 * (`organizations.timezone`/`branches.timezone`, both nullable IANA
 * identifiers validated server-side by `app.validate_iana_timezone()`), so
 * this function only picks between three already-known values. It never
 * itself validates the identifier: a corrupted value could only have
 * reached these columns by bypassing the RPC entirely, which is a
 * different, larger problem than this function can fix.
 */
export function resolveTimezone(branchTimezone: string | null | undefined, orgTimezone: string | null | undefined): string {
  return branchTimezone || orgTimezone || DASHBOARD_TIMEZONE_FALLBACK;
}
