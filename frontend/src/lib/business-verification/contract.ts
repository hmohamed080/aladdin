/**
 * The business verification contract the browser can check before anything uploads. It is NOT the
 * authority: the private bucket's `allowed_mime_types` / `file_size_limit`, the document metadata rows
 * and the business_verification_* RPCs (20261017160001) decide. Pure on purpose: no Supabase client.
 */
export const BV_BUCKET = "business-verification-documents";
export const BV_MAX_BYTES = 10 * 1024 * 1024;
export const BV_MAX_DRAFTS = 10;
export const BV_NOTE_MAX = 2000;
export const BV_REASON_MAX = 2000;
export const BV_ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export const BV_DOC_TYPES = ["commercial_register", "tax_card", "national_id", "lease_or_ownership", "other"] as const;
export type BvDocType = (typeof BV_DOC_TYPES)[number];

/** Owner/Admin-facing status of a request (the database maps its verification_status onto these). */
export const BV_STATUSES = ["none", "pending", "under_review", "needs_info", "verified", "rejected"] as const;
export type BvStatus = (typeof BV_STATUSES)[number];

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KEY_SHAPE = new RegExp(`^${UUID}/${UUID}\\.(pdf|jpg|png|webp)$`);
export const UUID_SHAPE = new RegExp(`^${UUID}$`);

export const isBvKey = (v: unknown): v is string => typeof v === "string" && KEY_SHAPE.test(v);
export const isBvDocType = (v: unknown): v is BvDocType => typeof v === "string" && (BV_DOC_TYPES as readonly string[]).includes(v);
export const isBvContentType = (t: string): boolean => (BV_ALLOWED_TYPES as readonly string[]).includes(t);
export const isBvStatus = (v: unknown): v is BvStatus => typeof v === "string" && (BV_STATUSES as readonly string[]).includes(v);

export type BvFileCheck = { ok: true } | { ok: false; code: "businessVerification.errors.fileType" | "businessVerification.errors.fileSize" };

export function validateBvFile(file: { type: string; size: number }): BvFileCheck {
  if (!isBvContentType(file.type)) return { ok: false, code: "businessVerification.errors.fileType" };
  if (file.size <= 0 || file.size > BV_MAX_BYTES) return { ok: false, code: "businessVerification.errors.fileSize" };
  return { ok: true };
}

/** Maps a database error message onto an i18n key. Unknown failures stay generic (never the raw text). */
export function mapBvError(message: string | undefined | null): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("at least one document")) return "businessVerification.errors.documentRequired";
  if (m.includes("answers the reviewer")) return "businessVerification.errors.answerRequired";
  if (m.includes("already being reviewed")) return "businessVerification.errors.inReview";
  if (m.includes("already verified")) return "businessVerification.errors.alreadyVerified";
  if (m.includes("only an approved organization")) return "businessVerification.errors.notApproved";
  if (m.includes("at most 10 documents")) return "businessVerification.errors.tooMany";
  if (m.includes("10 mb")) return "businessVerification.errors.fileSize";
  if (m.includes("content type")) return "businessVerification.errors.fileType";
  if (m.includes("kept as evidence")) return "businessVerification.errors.submittedDocument";
  if (m.includes("cannot add verification documents")) return "businessVerification.errors.notApproved";
  if (m.includes("reason of 1 to 2000")) return "businessVerification.errors.reasonRequired";
  if (m.includes("their own organization")) return "businessVerification.errors.ownOrganization";
  if (m.includes("verification.approve required")) return "businessVerification.errors.noApproveAuthority";
  if (m.includes("has not been uploaded") || m.includes("no matching pending")) return "businessVerification.errors.upload";
  if (m.includes("permission") || m.includes("not found")) return "businessVerification.errors.notAuthorized";
  if (m.includes("invalid transition") || m.includes("assigned reviewer")) return "businessVerification.errors.state";
  if (m.includes("only an active organization")) return "businessVerification.errors.notActive";
  return "states.genericRetry";
}
