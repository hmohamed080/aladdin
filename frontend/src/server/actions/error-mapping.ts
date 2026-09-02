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

/**
 * Maps a B2B execution (order / project) RPC error to a stable translation KEY.
 * Same principle as mapCommerceError: SQLSTATE + short stable message fragments,
 * never locale text. Authorization/lifecycle rules live in the RPCs.
 */
export function mapExecutionError(error: unknown): string {
  const e = (error ?? {}) as PgLikeError;
  const code = e.code ?? "";
  const msg = (e.message ?? "").toLowerCase();

  if (code === "40001" || msg.includes("modified concurrently")) return "execution.errors.conflict";
  if (msg.includes("order already exists for this quotation")) return "execution.errors.orderExists";
  if (msg.includes("project already exists for this order")) return "execution.errors.projectExists";
  if (msg.includes("only be created from an accepted quotation"))
    return "execution.errors.notAccepted";
  if (msg.includes("in-progress order can start a project")) return "execution.errors.orderNotStarted";
  if (msg.includes("only a confirmed order can be started")) return "execution.errors.orderNotConfirmed";
  if (msg.includes("only a confirmed order can be cancelled")) return "execution.errors.orderNotCancellable";
  if (msg.includes("only a planned project can be activated")) return "execution.errors.projectNotPlanned";
  if (msg.includes("only an active project can be completed")) return "execution.errors.projectNotActive";
  if (code === "42501" || msg.includes("required") || msg.includes("not a member"))
    return "execution.errors.denied";
  return "states.genericRetry";
}

/**
 * Maps a Jobs-domain RPC error to a stable translation KEY.
 *
 * Same principle as the three above: SQLSTATE plus short, stable English
 * fragments raised by the RPC itself — never locale text, and never the raw
 * message. Every rule these map to lives in the database (Increment 6); this
 * function only decides which sentence the poster reads.
 *
 * ORDER MATTERS. The lifecycle fragments are tested BEFORE the generic 42501
 * fallback, because several of them are raised with 42501 too — `job_publish`
 * refuses an unverified organization with a permission code, and collapsing that
 * into "you do not have permission" would tell an owner they lack an authority
 * they actually hold, and hide the one thing they can do about it.
 */
export function mapJobError(error: unknown): string {
  const e = (error ?? {}) as PgLikeError;
  const code = e.code ?? "";
  const msg = (e.message ?? "").toLowerCase();

  if (code === "40001" || msg.includes("modified concurrently")) return "jobs.errors.conflict";
  if (msg.includes("must be verified to publish")) return "jobs.errors.unverified";
  if (msg.includes("cancel its assignment first")) return "jobs.errors.awardedCancel";
  if (msg.includes("offer and trade")) return "jobs.errors.offerLocked";
  if (msg.includes("only a draft job can be published")) return "jobs.errors.notDraft";
  if (msg.includes("cannot be edited")) return "jobs.errors.notEditable";
  if (msg.includes("unknown or retired trade") || msg.includes("no longer available"))
    return "jobs.errors.tradeUnavailable";
  if (msg.includes("cannot be accepted") || msg.includes("cannot be rejected"))
    return "jobs.errors.alreadyDecided";
  if (msg.includes("cannot post work")) return "jobs.errors.inactiveOrg";
  if (msg.includes("only an open job") || msg.includes("not accepting applications"))
    return "jobs.errors.notOpen";
  if (code === "42501" || msg.includes("required") || msg.includes("not a member"))
    return "jobs.errors.denied";
  return "states.genericRetry";
}

/** True when the error means "the record moved under me" (caller should refresh). */
export function isStaleVersion(error: unknown): boolean {
  const e = (error ?? {}) as PgLikeError;
  return e.code === "40001" || (e.message ?? "").toLowerCase().includes("modified concurrently");
}

/**
 * The INSTALLER side of Jobs — applying, and withdrawing.
 *
 * Separate from `mapJobError` because the vocabulary is genuinely different: the
 * same SQLSTATE means something else on this side of the transaction, and the
 * sentence a professional needs is about their own candidacy rather than about a
 * job they manage. Folding both into one function would have meant a mapping
 * whose branches only make sense once you know which surface asked.
 *
 * The lifecycle fragments are tested BEFORE the generic 42501 branch, for the
 * same reason they are in `mapJobError`: `job_application_submit` raises the
 * persona refusal with 42501, and falling through would tell an installer they
 * lack a permission when what they lack is a professional account.
 */
export function mapApplicationError(error: unknown): string {
  const e = (error ?? {}) as PgLikeError;
  const code = e.code ?? "";
  const msg = (e.message ?? "").toLowerCase();

  if (msg.includes("professional account is required"))
    return "jobs.installerErrors.notProfessional";
  if (msg.includes("not accepting applications") || msg.includes("not currently open"))
    return "jobs.installerErrors.notOpenNow";
  if (msg.includes("cannot be withdrawn")) return "jobs.installerErrors.notWithdrawable";
  if (msg.includes("only the applicant")) return "jobs.installerErrors.notYours";
  if (msg.includes("cannot be accepted") || msg.includes("cannot be rejected"))
    return "jobs.installerErrors.alreadyDecided";
  if (code === "40001" || msg.includes("modified concurrently")) return "jobs.errors.conflict";
  if (code === "42501") return "jobs.errors.denied";
  return "states.genericRetry";
}
