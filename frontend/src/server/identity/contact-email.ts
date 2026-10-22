import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { EmailTransport } from "@/server/email/transactional";
import { EMAIL_BRAND } from "@/server/email/brand";

/**
 * The optional CONTACT email (separate from the sign-in email): set it with the current password, verify it through a
 * single-use link plus an explicit confirmation, remove it with the current password.
 *
 * Every rule lives in the database (20261021090005_contact_email_claims.sql): global uniqueness against every other
 * account's sign-in and verified contact email, the abuse limits, single use, the explicit-action requirement. This module
 * only (a) proves the current password through PR #88's account_password_confirm, called with the CALLER's session so the
 * receipt is bound to auth.uid(); (b) mints the token (32 random bytes) and hands the database ONLY its SHA-256; (c) sends
 * the link; (d) maps outcomes to translation keys. The plaintext token exists in this request and in the email only.
 *
 * Anti-enumeration: an address held by another account answers exactly like a sent link ('sent'), and nothing is mailed.
 */
export const CONTACT_EMAIL_CODES = {
  sent: "contactEmail.sent",
  verified: "contactEmail.verified",
  removed: "contactEmail.removed",
  cancelled: "contactEmail.cancelled",
  alreadyVerified: "contactEmail.alreadyVerified",
  invalidEmail: "contactEmail.error.invalidEmail",
  passwordRequired: "contactEmail.error.passwordRequired",
  wrongPassword: "contactEmail.error.wrongPassword",
  locked: "contactEmail.error.locked",
  noPassword: "contactEmail.error.noPassword",
  limited: "contactEmail.error.limited",
  sessionExpired: "contactEmail.error.sessionExpired",
  unavailable: "contactEmail.error.unavailable",
  linkInvalid: "contactEmail.error.linkInvalid",
  linkExpired: "contactEmail.error.linkExpired",
  addressUnavailable: "contactEmail.error.addressUnavailable",
} as const;

export type ContactEmailResult = { ok: true; code: string } | { ok: false; code: string; retryAfterSeconds?: number };

export type ContactEmailStatus = {
  status: "none" | "pending" | "verified" | "expired" | "released";
  email: string | null;
  verifiedVia: "email_link" | "auth_email" | null;
  pendingUntil: string | null;
};

type Rpc = Pick<SupabaseClient<Database>, "rpc">;

export type ContactEmailDeps = {
  /** The caller's own (RLS) client: account_password_confirm binds the receipt to auth.uid(). */
  user: Rpc;
  /** Service-role client for the contact_email_* functions (service_role only by design). */
  service: Rpc;
  send: EmailTransport;
  /** 32 random bytes. */
  randomBytes(): Uint8Array;
  sha256(data: Uint8Array): Promise<Uint8Array>;
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const LINK_TTL_SECONDS = 1800;

/** SHA-256 through Web Crypto (Node and Workers alike). */
export async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(data)));
}

export function normalizeContactEmail(raw: unknown): string | null {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value.length === 0 || value.length > 254 || !EMAIL.test(value) || value.endsWith("@craftsman-login.aladdin.invalid")) return null;
  return value;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(token: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const binary = atob(token.replace(/-/g, "+").replace(/_/g, "/") + "=");
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out.length === 32 ? out : null;
}

/** PostgREST takes bytea as a `\x`-prefixed hex string. */
export function byteaHex(bytes: Uint8Array): string {
  return "\\x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function confirm(deps: ContactEmailDeps, operation: "contact_email.set" | "contact_email.remove", target: string, password: string) {
  const { data, error } = await deps.user.rpc("account_password_confirm", { p_password: password, p_operation: operation, p_target: target });
  if (error) {
    if (error.code === "42501") return { ok: false as const, code: CONTACT_EMAIL_CODES.sessionExpired };
    console.error(`contact email: password confirmation failed (code ${error.code ?? "unknown"})`);
    return { ok: false as const, code: CONTACT_EMAIL_CODES.unavailable };
  }
  const row = (data ?? {}) as { ok?: boolean; receipt?: string; reason?: string; retry_at?: string };
  if (row.ok === true && typeof row.receipt === "string") return { ok: true as const, receipt: row.receipt };
  if (row.reason === "wrong_password") return { ok: false as const, code: CONTACT_EMAIL_CODES.wrongPassword };
  if (row.reason === "no_password") return { ok: false as const, code: CONTACT_EMAIL_CODES.noPassword };
  if (row.reason === "locked") {
    const until = row.retry_at ? Date.parse(row.retry_at) : Number.NaN;
    return {
      ok: false as const,
      code: CONTACT_EMAIL_CODES.locked,
      retryAfterSeconds: Number.isFinite(until) ? Math.max(1, Math.ceil((until - Date.now()) / 1000)) : 900,
    };
  }
  return { ok: false as const, code: CONTACT_EMAIL_CODES.unavailable };
}

export type StartInput = { userId: string; email: unknown; password: unknown; origin: string | null; locale: "ar" | "en" };

export async function startContactEmail(deps: ContactEmailDeps, input: StartInput): Promise<ContactEmailResult> {
  const email = normalizeContactEmail(input.email);
  if (!email) return { ok: false, code: CONTACT_EMAIL_CODES.invalidEmail };
  if (typeof input.password !== "string" || input.password.length === 0) return { ok: false, code: CONTACT_EMAIL_CODES.passwordRequired };
  if (!input.origin) {
    console.error("contact email: no trusted link origin is configured (APP_PUBLIC_ORIGIN)");
    return { ok: false, code: CONTACT_EMAIL_CODES.unavailable };
  }

  const proof = await confirm(deps, "contact_email.set", email, input.password);
  if (!proof.ok) return proof;

  const token = deps.randomBytes();
  const hash = await deps.sha256(token);
  const { data, error } = await deps.service.rpc("contact_email_claim_start", {
    p_user_id: input.userId,
    p_receipt_id: proof.receipt,
    p_email: email,
    p_token_hash: byteaHex(hash),
    p_ttl_seconds: LINK_TTL_SECONDS,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, code: CONTACT_EMAIL_CODES.sessionExpired };
    if (error.code === "22023") return { ok: false, code: CONTACT_EMAIL_CODES.invalidEmail };
    console.error(`contact email: claim start failed (code ${error.code ?? "unknown"})`);
    return { ok: false, code: CONTACT_EMAIL_CODES.unavailable };
  }
  const row = Array.isArray(data) ? data[0] : undefined;
  const outcome = row?.outcome;
  if (outcome === "verified") return { ok: true, code: CONTACT_EMAIL_CODES.verified };
  if (outcome === "already_verified") return { ok: true, code: CONTACT_EMAIL_CODES.alreadyVerified };
  if (outcome === "limited") return { ok: false, code: CONTACT_EMAIL_CODES.limited };
  if (outcome === "suppressed") return { ok: true, code: CONTACT_EMAIL_CODES.sent };   // same answer, nothing was mailed
  if (outcome !== "sent" || row?.deliver !== true) return { ok: false, code: CONTACT_EMAIL_CODES.unavailable };

  const link = new URL("/settings/contact-email/confirm", input.origin);
  link.searchParams.set("token", toBase64Url(token));
  const sent = await deps.send(contactEmailMessage(email, link.toString(), input.locale));
  if (!sent.ok) {
    // Nothing must stay pending that the owner never received: cancel it (a pending claim needs no receipt).
    await deps.service.rpc("contact_email_release", { p_user_id: input.userId, p_receipt_id: null as unknown as string });
    return { ok: false, code: CONTACT_EMAIL_CODES.unavailable };
  }
  return { ok: true, code: CONTACT_EMAIL_CODES.sent };
}

export type PeekResult = { state: "valid" | "expired" | "invalid"; maskedEmail: string | null };

/** What the confirmation page may show. Opening a link NEVER verifies anything: the database's peek performs no write. */
export async function peekContactEmailLink(deps: Pick<ContactEmailDeps, "service" | "sha256">, userId: string, token: string): Promise<PeekResult> {
  const raw = fromBase64Url(token);
  if (!raw) return { state: "invalid", maskedEmail: null };
  const { data, error } = await deps.service.rpc("contact_email_token_peek", { p_user_id: userId, p_token_hash: byteaHex(await deps.sha256(raw)) });
  const row = Array.isArray(data) ? data[0] : undefined;
  if (error || !row) return { state: "invalid", maskedEmail: null };
  const state = row.state === "valid" || row.state === "expired" ? row.state : "invalid";
  return { state, maskedEmail: state === "invalid" ? null : (row.masked_email ?? null) };
}

/** The explicit confirmation (a POST the owner made by pressing the button). */
export async function confirmContactEmailLink(deps: Pick<ContactEmailDeps, "service" | "sha256">, userId: string, token: unknown): Promise<ContactEmailResult> {
  const raw = typeof token === "string" ? fromBase64Url(token) : null;
  if (!raw) return { ok: false, code: CONTACT_EMAIL_CODES.linkInvalid };
  const { data, error } = await deps.service.rpc("contact_email_claim_confirm", {
    p_user_id: userId,
    p_token_hash: byteaHex(await deps.sha256(raw)),
    p_explicit_action: true,
  });
  if (error) {
    console.error(`contact email: confirmation failed (code ${error.code ?? "unknown"})`);
    return { ok: false, code: CONTACT_EMAIL_CODES.unavailable };
  }
  const outcome = Array.isArray(data) ? data[0]?.outcome : undefined;
  switch (outcome) {
    case "verified": return { ok: true, code: CONTACT_EMAIL_CODES.verified };
    case "expired": return { ok: false, code: CONTACT_EMAIL_CODES.linkExpired };
    case "unavailable": return { ok: false, code: CONTACT_EMAIL_CODES.addressUnavailable };
    case "limited": return { ok: false, code: CONTACT_EMAIL_CODES.limited };
    default: return { ok: false, code: CONTACT_EMAIL_CODES.linkInvalid };
  }
}

/** Remove a VERIFIED contact email (current password) or cancel a pending link (no password needed). */
export async function removeContactEmail(deps: ContactEmailDeps, input: { userId: string; password: unknown; verified: boolean }): Promise<ContactEmailResult> {
  let receipt: string | null = null;
  if (input.verified) {
    if (typeof input.password !== "string" || input.password.length === 0) return { ok: false, code: CONTACT_EMAIL_CODES.passwordRequired };
    const proof = await confirm(deps, "contact_email.remove", "self", input.password);
    if (!proof.ok) return proof;
    receipt = proof.receipt;
  }
  const { data, error } = await deps.service.rpc("contact_email_release", { p_user_id: input.userId, p_receipt_id: receipt as unknown as string });
  if (error) {
    if (error.code === "42501") return { ok: false, code: CONTACT_EMAIL_CODES.passwordRequired };
    console.error(`contact email: release failed (code ${error.code ?? "unknown"})`);
    return { ok: false, code: CONTACT_EMAIL_CODES.unavailable };
  }
  const outcome = Array.isArray(data) ? data[0]?.outcome : undefined;
  return { ok: true, code: outcome === "removed" ? CONTACT_EMAIL_CODES.removed : CONTACT_EMAIL_CODES.cancelled };
}

export async function loadContactEmailStatus(service: Rpc, userId: string): Promise<ContactEmailStatus> {
  const { data, error } = await service.rpc("contact_email_status", { p_user_id: userId });
  const row = Array.isArray(data) ? data[0] : undefined;
  if (error || !row) return { status: "none", email: null, verifiedVia: null, pendingUntil: null };
  const status = (["pending", "verified", "expired", "released"] as const).find((s) => s === row.status) ?? "none";
  return {
    status,
    email: row.email ?? null,
    verifiedVia: row.verified_via === "email_link" || row.verified_via === "auth_email" ? row.verified_via : null,
    pendingUntil: row.token_expires_at ?? null,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function contactEmailMessage(to: string, link: string, locale: "ar" | "en") {
  const copy = locale === "ar"
    ? {
        subject: "أكّد بريدك الإلكتروني للتواصل على علاء الدين",
        intro: "طلبت إضافة هذا البريد الإلكتروني كبريد للتواصل في حسابك على علاء الدين.",
        action: "افتح الرابط ثم اضغط «تأكيد» لإكمال الإضافة. الرابط صالح لمدة 30 دقيقة ويُستخدم مرة واحدة.",
        button: "تأكيد البريد الإلكتروني",
        ignore: "إذا لم تطلب ذلك، تجاهل هذه الرسالة ولن يتغيّر شيء.",
      }
    : {
        subject: "Confirm your Aladdin contact email",
        intro: "You asked to add this email address as the contact email of your Aladdin account.",
        action: "Open the link, then press Confirm to finish. The link works once and expires in 30 minutes.",
        button: "Confirm email",
        ignore: "If you did not ask for this, ignore this message and nothing will change.",
      };
  const dir = locale === "ar" ? "rtl" : "ltr";
  return {
    to,
    subject: copy.subject,
    text: `${copy.intro}\n\n${copy.action}\n\n${link}\n\n${copy.ignore}`,
    html: `<!doctype html><html lang="${locale}" dir="${dir}"><body style="margin:0;background:${EMAIL_BRAND.cream};font-family:Arial,sans-serif;color:${EMAIL_BRAND.navy}">`
      + `<div style="max-width:520px;margin:0 auto;padding:32px 24px"><p style="font-size:16px;line-height:1.6">${escapeHtml(copy.intro)}</p>`
      + `<p style="font-size:16px;line-height:1.6">${escapeHtml(copy.action)}</p>`
      + `<p><a href="${escapeHtml(link)}" style="display:inline-block;background:${EMAIL_BRAND.navy};color:${EMAIL_BRAND.cream};padding:12px 20px;border-radius:8px;text-decoration:none;font-size:16px">${escapeHtml(copy.button)}</a></p>`
      + `<p style="font-size:14px;line-height:1.6;color:${EMAIL_BRAND.navy}">${escapeHtml(copy.ignore)}</p></div></body></html>`,
  };
}
