/**
 * The verification states in which a reviewer may still approve or reject (`review_start` / `review_approve` /
 * `review_reject`). Pure and client-safe: the Users directory loader, the user page and the tests share it.
 */
export const OPEN_VERIFICATION_STATUSES = ["submitted", "under_review", "needs_more_info"] as const;

export function isOpenVerificationStatus(status: string): boolean {
  return (OPEN_VERIFICATION_STATUSES as readonly string[]).includes(status);
}
