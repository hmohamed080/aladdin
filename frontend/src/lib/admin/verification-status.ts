/**
 * The verification states in which a reviewer may still approve or reject (`review_start` / `review_approve` /
 * `review_reject`). Pure and client-safe: the Users directory loader, the user page and the tests share it.
 */
export const OPEN_VERIFICATION_STATUSES = ["submitted", "under_review", "needs_more_info"] as const;

export function isOpenVerificationStatus(status: string): boolean {
  return (OPEN_VERIFICATION_STATUSES as readonly string[]).includes(status);
}

/** The professional account types whose owner can be verified (mirrors admin_initiate_verification). */
const PROFESSIONAL_ACCOUNT_TYPES: readonly string[] = ["engineer", "installer_technician", "contractor", "sales"];

/**
 * Whether the Admin UI offers "Start verification" for a user who has no open request. A hint only: the database
 * function decides (permission, active account, no approved verification, no duplicate) and refuses anything else.
 */
export function canStartVerification(u: {
  accountType: string | null;
  registeredAccount?: string | null;
  status: string;
  verificationState?: string;
}): boolean {
  const type = u.accountType ?? u.registeredAccount ?? null;
  return (
    type !== null &&
    PROFESSIONAL_ACCOUNT_TYPES.includes(type) &&
    u.status !== "suspended" &&
    u.status !== "deactivated" &&
    u.verificationState !== "verified"
  );
}

/**
 * The derived "Profile incomplete" warning: a VERIFIED account whose authoritative profile completion is below 100.
 * Never stored, never revokes anything; it disappears by itself when completion returns to 100. The same rule the
 * database applies to the "Needs attention" tab.
 */
export function isProfileIncomplete(u: { verificationState: string; completion: number }): boolean {
  return u.verificationState === "verified" && u.completion < 100;
}
