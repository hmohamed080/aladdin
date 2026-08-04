/**
 * Maps a Postgres/RPC error to a stable translation KEY (never a raw DB string).
 * Authorization lives in the database (ADR-0008); the UI only translates the
 * outcome. We match on SQLSTATE and, where the RPC raises a specific message,
 * on a short stable fragment — never on locale-specific text.
 */
type PgLikeError = { code?: string; message?: string };

export function mapSalesError(error: unknown): string {
  const e = (error ?? {}) as PgLikeError;
  const code = e.code ?? "";
  const msg = (e.message ?? "").toLowerCase();

  if (code === "23505" || msg.includes("phone already exists")) return "states.duplicatePhone";
  if (code === "40001" || msg.includes("modified concurrently")) return "leads.conflict";
  if (msg.includes("a reason is required when marking")) return "leads.lostReasonRequired";
  if (msg.includes("branch not in caller scope") || msg.includes("another tenant"))
    return "states.branchDenied";
  if (msg.includes("assignee") && msg.includes("branch")) return "states.assigneeBranch";
  if (msg.includes("sales.assign") || msg.includes("assign a follow-up") || msg.includes("assign records"))
    return "states.assignDenied";
  if (code === "42501" || msg.includes("required") || msg.includes("not a member"))
    return "states.salesWriteDenied";
  return "states.genericRetry";
}

/** True when the error means "the record moved under me" (caller should refresh). */
export function isStaleVersion(error: unknown): boolean {
  const e = (error ?? {}) as PgLikeError;
  return e.code === "40001" || (e.message ?? "").toLowerCase().includes("modified concurrently");
}
