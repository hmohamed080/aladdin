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
  if (msg.includes("only an open follow-up")) return "states.followUpNotOpen";
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

/**
 * Maps a commerce (catalog / RFQ / quotation) RPC error to a stable translation
 * KEY. Same principle as mapSalesError: SQLSTATE + short stable message fragments,
 * never locale text. Authorization/lifecycle rules live in the RPCs.
 */
export function mapCommerceError(error: unknown): string {
  const e = (error ?? {}) as PgLikeError;
  const code = e.code ?? "";
  const msg = (e.message ?? "").toLowerCase();

  if (code === "40001" || msg.includes("modified concurrently")) return "commerce.errors.conflict";
  if (msg.includes("live quotation already exists")) return "commerce.errors.quotationExists";
  if (msg.includes("at least one item")) return "commerce.errors.rfqNeedsItem";
  if (msg.includes("price every line") || msg.includes("every line must have a price"))
    return "commerce.errors.quotationNeedsPrices";
  if (msg.includes("published product of the supplier")) return "commerce.errors.productNotPublished";
  if (msg.includes("cannot send an rfq to itself")) return "commerce.errors.selfRfq";
  if (msg.includes("only a draft")) return "commerce.errors.notDraft";
  if (msg.includes("only a submitted")) return "commerce.errors.notSubmitted";
  if (msg.includes("branch not in caller scope")) return "states.branchDenied";
  if (code === "42501" || msg.includes("required") || msg.includes("not a member"))
    return "commerce.errors.denied";
  return "states.genericRetry";
}

/** True when the error means "the record moved under me" (caller should refresh). */
export function isStaleVersion(error: unknown): boolean {
  const e = (error ?? {}) as PgLikeError;
  return e.code === "40001" || (e.message ?? "").toLowerCase().includes("modified concurrently");
}
