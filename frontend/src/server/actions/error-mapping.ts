import type { AssetErrorCode } from "@/lib/storage/professional-assets";

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

/**
 * The assignment LIFECYCLE — start, progress, complete, cancel.
 *
 * A third mapper rather than a branch in either of the other two, because this
 * is the first domain surface with TWO actors on it. `mapJobError` speaks to a
 * poster about a job they manage and `mapApplicationError` speaks to an
 * applicant about their own candidacy; the same SQLSTATE here has to answer for
 * an installer reporting progress and for an organization confirming completion,
 * and the sentences are not interchangeable.
 *
 * The order matters for the same reason it does in the other two. `42501` is
 * raised for three genuinely different refusals — not the assigned installer,
 * not a member of the posting organization, and no `job.manage` — and each is
 * named before the generic branch can swallow it. An installer told "you lack a
 * permission" when the real answer is "this is not your assignment" would go
 * looking for a settings page that does not exist.
 */
export function mapAssignmentError(error: unknown): string {
  const e = (error ?? {}) as PgLikeError;
  const code = e.code ?? "";
  const msg = (e.message ?? "").toLowerCase();

  if (code === "40001" || msg.includes("modified concurrently"))
    return "work.errors.conflict";
  if (msg.includes("only the assigned installer may start"))
    return "work.errors.notYoursToStart";
  if (msg.includes("only the assigned installer may report"))
    return "work.errors.notYoursToReport";
  if (msg.includes("only a party to this assignment"))
    return "work.errors.notAParty";
  if (msg.includes("cannot be started")) return "work.errors.notScheduled";
  if (msg.includes("progress can only be reported")) return "work.errors.notInProgress";
  if (msg.includes("progress must be between")) return "work.errors.progressRange";
  if (msg.includes("cannot be completed")) return "work.errors.notCompletable";
  if (msg.includes("cannot be cancelled")) return "work.errors.notCancellable";
  if (msg.includes("a reason is required")) return "work.errors.reasonRequired";
  if (msg.includes("job.manage required")) return "work.errors.manageRequired";
  if (msg.includes("not a member")) return "work.errors.notAMember";
  if (msg.includes("assignment not found")) return "work.errors.notFound";
  if (code === "42501") return "jobs.errors.denied";
  return "states.genericRetry";
}

/**
 * Maps a Supabase Storage failure to a stable translation KEY.
 *
 * Different in shape from every mapper above it, because Storage is a different
 * system. There is no SQLSTATE: refusals arrive as HTTP 400 carrying a typed
 * body — `{"statusCode":"403","code":"AccessDenied"}` — so the HTTP status is
 * the same for a policy denial, a rejected content type, an oversized body and a
 * duplicate key alike. `code` is what distinguishes them, and the message
 * fragments are the fallback for client versions that surface only a string.
 *
 * THE ONE JUDGEMENT CALL. `AccessDenied` and `NoSuchKey` both mean "you are not
 * getting this object", and on the READ path they are genuinely the same event:
 * the SELECT policy hides the row, so Storage cannot find someone else's file
 * and says so. They are still mapped to DIFFERENT keys, because the two
 * sentences a person needs are different — "this file is no longer here" after a
 * delete elsewhere, versus "you cannot do that". Neither key confirms that
 * anyone else's object exists.
 */
export function mapAssetError(error: unknown): AssetErrorCode {
  const e = (error ?? {}) as PgLikeError & { code?: string; statusCode?: string };
  const code = e.code ?? "";
  const msg = (e.message ?? "").toLowerCase();

  if (code === "EntityTooLarge" || msg.includes("exceeded the maximum allowed size"))
    return "assets.errors.tooLarge";
  if (code === "InvalidMimeType" || msg.includes("is not supported"))
    return "assets.errors.unsupportedType";
  if (code === "NoSuchKey" || msg.includes("object not found") || msg.includes("not_found"))
    return "assets.errors.gone";
  if (code === "KeyAlreadyExists" || msg.includes("resource already exists"))
    return "assets.errors.uploadFailed";
  if (
    code === "AccessDenied" ||
    msg.includes("row-level security") ||
    msg.includes("access denied") ||
    msg.includes("unauthorized")
  )
    return "assets.errors.notAllowed";
  return "assets.errors.uploadFailed";
}

/**
 * Maps a Portfolio / Certificates RPC error to a stable translation KEY.
 *
 * One mapper for both domains, because they share every failure mode they have:
 * the same persona gate, the same ownership check, the same lifecycle guard. What
 * they do NOT share is a public surface, and that difference produces no error —
 * a certificate has no publish path to refuse, so there is nothing here to say
 * about one.
 *
 * `42501` covers three genuinely different refusals and each is named before the
 * generic branch can swallow it: not a professional, not yours, and not signed in.
 * A professional told "this is not yours" when the real answer is "your account is
 * no longer a professional one" would go looking for the wrong fix.
 */
export function mapPortfolioError(error: unknown): string {
  const e = (error ?? {}) as PgLikeError;
  const code = e.code ?? "";
  const msg = (e.message ?? "").toLowerCase();

  if (msg.includes("professional persona is required"))
    return "portfolio.errors.notProfessional";
  if (msg.includes("unfinished item cannot be published"))
    return "portfolio.errors.notReady";
  if (msg.includes("unsupported content type")) return "assets.errors.unsupportedType";
  if (msg.includes("portfolio item not found")) return "portfolio.errors.notFound";
  if (msg.includes("certificate not found")) return "certificates.errors.notFound";
  if (msg.includes("cannot be finalized")) return "portfolio.errors.notReady";
  if (msg.includes("unknown direction")) return "states.genericRetry";
  // The one validation performed on the claim itself: an expiry before its issue.
  if (code === "23514" && msg.includes("ck_certificate_dates"))
    return "certificates.errors.dateOrder";
  if (code === "23514") return "assets.errors.unsupportedType";
  if (msg.includes("authentication required") || code === "42501")
    return "portfolio.errors.denied";
  return "states.genericRetry";
}
