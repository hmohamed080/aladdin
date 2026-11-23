/**
 * The Admin dashboard's Pending / Verified / Rejected user cards come from the SAME tab counts the Users directory shows
 * (`admin_users_directory().counts`), so each card equals the list it links to. When that read fails every one of them is
 * a dash: never a misleading zero and never a number from a different source. Historical rejected verification requests
 * and their audit records are untouched; the Rejected tab is "latest decision was a rejection".
 */
export type UserTabCounts = { pending: number; verified: number; rejected: number };

export function dashboardUserCards(
  result: { ok: true; data: { counts: UserTabCounts } } | { ok: false },
): { pending: number | string; verified: number | string; rejected: number | string } {
  if (!result.ok) return { pending: "—", verified: "—", rejected: "—" };
  const { pending, verified, rejected } = result.data.counts;
  return { pending, verified, rejected };
}
