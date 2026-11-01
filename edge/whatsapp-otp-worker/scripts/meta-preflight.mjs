#!/usr/bin/env node
// READ-ONLY Meta WhatsApp Cloud API preflight. Sends NOTHING, creates nothing, changes nothing: GET requests to graph.facebook.com only
// (plus, only when explicitly opted in, one POST to debug_token, which is a read).
//
//   WHATSAPP_ACCESS_TOKEN=<token> WHATSAPP_PHONE_NUMBER_ID=<sender id> WHATSAPP_BUSINESS_ACCOUNT_ID=<WABA / messaging account id> \
//     [WHATSAPP_ACCOUNT_ID=<WhatsApp Account that holds the number, only if different>] node edge/whatsapp-otp-worker/scripts/meta-preflight.mjs
//
// Run it in your own shell from your secret store; never paste a token into a chat. It prints booleans, enums, sanitized Graph error codes and
// the LAST FOUR digits of ids only - never the token, never a template body, never a recipient. Exit 0 only when every check passes.
//
// ACCOUNT MODEL (Graph v25.0, Meta's 2026 WhatsApp Account Model Evolution): WhatsApp Accounts hold phone numbers; Messaging Accounts hold
// templates and billing. Existing WABA ids generally ARE the Messaging Account ids and legacy edges stay compatible. `?metadata=1` node
// introspection is deprecated in v25.0 (it answers HTTP 400), so NOTHING here relies on it. Evidence used instead, all supported read-only calls:
//   - sender: the phone-number fields themselves (display_phone_number, status, account_mode, code_verification_status, name_status,
//     quality_rating) plus an EXACT id echo (`id` in the answer equals the id asked for) and equality with the id pinned in wrangler.jsonc;
//   - account: a successful `/{account}/message_templates?name=aladdin_otp` proves the id serves templates; the answer must contain the approved
//     template (shape checked below);
//   - association (NOT weakened): the account must LIST the sender through `/{account}/phone_numbers` (paged). If Meta's migrated model does
//     not list the number there, the script reports not ready with the sanitized Graph error rather than guessing. An optional
//     WHATSAPP_ACCOUNT_ID (the WhatsApp Account that holds the number) is checked the same way; the template lookup and the association
//     must both succeed for the SAME account id.
//
// TOKEN HANDLING: the token travels ONLY in the Authorization header (never in a URL, query string or log line). `debug_token` is NOT called by
// default; token introspection is opt-in (META_PREFLIGHT_RESOLVE_FROM_TOKEN=1) and sends `input_token` in a POST form body, never in a URL.
// Graph errors are reported as sanitized code / subcode / type / message (long digit runs, numbers and token-like strings removed).
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const GRAPH = "https://graph.facebook.com";
const VERSION = "v25.0";
/** The authority's challenge_ttl default and the transport's ttlSeconds (300): the template's "expires in N minutes" must not lie. */
export const EXPECTED_EXPIRY_MINUTES = 5;

export function evaluateSender(p, requestedId) {
  const checks = {
    // v25.0-safe node evidence: the answer echoes the id that was asked for (skipped only when no id is supplied, e.g. unit use)
    exact_id_echo: requestedId === undefined ? true : String(p?.id) === requestedId,
    connected: p?.status === "CONNECTED",
    live_not_sandbox: p?.account_mode === "LIVE",
    code_verified: p?.code_verification_status === "VERIFIED",
    name_approved: p?.name_status === "APPROVED" || p?.name_status === "AVAILABLE_WITHOUT_REVIEW",
    quality_not_red: p?.quality_rating !== "RED",
  };
  return { checks, ok: Object.values(checks).every(Boolean), display_suffix: String(p?.display_phone_number ?? "").replace(/\D/g, "").slice(-4) || null, quality: p?.quality_rating ?? null };
}

export function evaluateTemplate(list, { name = "aladdin_otp", language = "ar" } = {}) {
  const t = (list?.data ?? []).find((x) => x?.name === name && x?.language === language);
  const comps = Array.isArray(t?.components) ? t.components : [];
  const body = comps.find((c) => c.type === "BODY");
  const footer = comps.find((c) => c.type === "FOOTER");
  const buttons = comps.find((c) => c.type === "BUTTONS")?.buttons ?? [];
  const checks = {
    exists_in_language: Boolean(t),
    approved: t?.status === "APPROVED",
    authentication_category: t?.category === "AUTHENTICATION",
    has_body: Boolean(body),
    // EXACTLY one button, and it must be COPY_CODE. The Worker fills body parameter 1 and button index 0 (sub_type "url") with the code, which
    // is the Copy Code send contract. ONE_TAP / ZERO_TAP need Android package + signature-hash parameters the Worker never sends, so a template
    // with one of those would pass a looser check yet fail or mis-render on a handset: refused on purpose.
    has_exactly_one_button: buttons.length === 1,
    button_is_copy_code: buttons.length === 1 && buttons[0].type === "OTP" && buttons[0].otp_type === "COPY_CODE",
    // The template tells the person the code expires in N minutes (FOOTER.code_expiration_minutes). It must equal the authority's code lifetime.
    expiry_matches_authority: footer?.code_expiration_minutes === EXPECTED_EXPIRY_MINUTES,
  };
  return { checks, ok: Object.values(checks).every(Boolean), status: t?.status ?? null, category: t?.category ?? null, expiry_minutes: footer?.code_expiration_minutes ?? null };
}

/** The sender id pinned in wrangler.jsonc (non-secret). Null if unreadable. */
export function configuredSenderId() {
  try {
    const raw = readFileSync(fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)), "utf8");
    return JSON.parse(raw).vars?.WHATSAPP_PHONE_NUMBER_ID ?? null;
  } catch { return null; }
}

const tail4 = (id) => String(id).slice(-4);

/** Candidate ids, in order: the supplied one, then (opt-in introspection) every target the token was granted for WhatsApp management/messaging. */
export function candidateIds(suppliedId, debugData) {
  const granted = (debugData?.data?.granular_scopes ?? [])
    .filter((s) => /^whatsapp_business_(management|messaging)$/.test(String(s?.scope)))
    .flatMap((s) => Array.isArray(s.target_ids) ? s.target_ids.map(String) : []);
  return [...new Set([suppliedId, ...granted].filter((x) => /^\d{5,30}$/.test(String(x ?? ""))))];
}

/** Graph error -> a few safe fields. No token, no long digit run (ids, numbers), no long token-like string, bounded length. */
export function sanitizeError(data, token = "") {
  const er = data?.error;
  if (!er || typeof er !== "object") return null;
  let msg = String(er.message ?? "");
  if (token) msg = msg.split(token).join("[redacted]");
  msg = msg.replace(/[A-Za-z0-9_|.-]{24,}/g, "[redacted]").replace(/\+?\d[\d\s-]{4,}\d/g, "[number]").replace(/\d{5,}/g, "[id]");
  return {
    code: Number.isInteger(er.code) ? er.code : null,
    subcode: Number.isInteger(er.error_subcode) ? er.error_subcode : null,
    type: typeof er.type === "string" ? er.type.slice(0, 40) : null,
    message: msg.slice(0, 160),
  };
}

export async function run(env, fetchImpl = fetch, log = console.log, pinned = configuredSenderId()) {
  const need = ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"].filter((k) => !env[k]);
  if (need.length) { log("NOT RUN - missing: " + need.join(", ") + ". Nothing was called."); return 3; }
  const supplied = env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const waAccount = env.WHATSAPP_ACCOUNT_ID;
  const numeric = (x) => /^\d{5,30}$/.test(x);
  if (!numeric(env.WHATSAPP_PHONE_NUMBER_ID) || (supplied && !numeric(supplied)) || (waAccount && !numeric(waAccount))) { log("NOT RUN - ids must be numeric."); return 2; }
  const token = env.WHATSAPP_ACCESS_TOKEN;
  const ALLOWED = [
    /^\d+\?fields=[a-z_,]+$/,                                                          // the sender's own fields
    /^\d+\/phone_numbers\?fields=id&limit=\d{1,3}(&after=[A-Za-z0-9=_-]{1,200})?$/,    // senders an account lists (paged)
    /^\d+\/message_templates\?name=aladdin_otp&fields=[a-z_,]+$/,                      // templates of a messaging account
  ];
  const call = async (method, path, body) => {
    const r = await fetchImpl(`${GRAPH}/${VERSION}/${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
      ...(body ? { body } : {}),
    });
    const data = await r.json().catch(() => null);
    return { status: r.status, data, error: r.status === 200 ? null : sanitizeError(data, token) };
  };
  const get = (path) => {
    if (!ALLOWED.some((re) => re.test(path))) throw new Error("REFUSED: not an allowed read-only call");
    return call("GET", path);
  };
  // Opt-in only. The token to inspect goes in the POST BODY, never in the URL.
  const introspect = () => call("POST", "debug_token", new URLSearchParams({ input_token: token }).toString());

  const sender = await get(`${env.WHATSAPP_PHONE_NUMBER_ID}?fields=id,display_phone_number,verified_name,status,account_mode,code_verification_status,name_status,quality_rating`);
  const senderEval = sender.status === 200 ? evaluateSender(sender.data, env.WHATSAPP_PHONE_NUMBER_ID) : { ok: false, http: sender.status, error: sender.error };
  const senderId = {
    id_suffix: tail4(env.WHATSAPP_PHONE_NUMBER_ID),
    repo_config_suffix: pinned ? tail4(pinned) : null,
    matches_repo_config: pinned === env.WHATSAPP_PHONE_NUMBER_ID,
    echoed_id_matches: sender.status === 200 && String(sender.data?.id) === env.WHATSAPP_PHONE_NUMBER_ID,
  };

  // ---- candidate accounts: supplied messaging account / WABA, the optional WhatsApp Account, and (opt-in) the token's own grants ----
  const debug = env.META_PREFLIGHT_RESOLVE_FROM_TOKEN === "1" ? await introspect().catch(() => ({ status: 0, data: null })) : { status: 0, data: null };
  const candidates = candidateIds(supplied, debug.status === 200 ? debug.data : null);
  if (waAccount && !candidates.includes(waAccount)) candidates.push(waAccount);

  /** Does this account list the sender? Pages through /phone_numbers (max 5 pages of 100). */
  const listsSender = async (id) => {
    let path = `${id}/phone_numbers?fields=id&limit=100`;
    for (let page = 0; page < 5; page++) {
      const res = await get(path);
      if (res.status !== 200) return { owns: false, http: res.status, error: res.error };
      if ((res.data?.data ?? []).some((x) => String(x?.id) === env.WHATSAPP_PHONE_NUMBER_ID)) return { owns: true };
      const after = res.data?.paging?.cursors?.after;
      if (!res.data?.paging?.next || !after || !/^[A-Za-z0-9=_-]{1,200}$/.test(String(after))) break;
      path = `${id}/phone_numbers?fields=id&limit=100&after=${after}`;
    }
    return { owns: false };
  };

  const checked = []; let wabaId = null; let tpl = null;
  for (const id of candidates) {
    const t = await get(`${id}/message_templates?name=aladdin_otp&fields=name,language,status,category,components`);
    const a = await listsSender(id);
    checked.push({
      id_suffix: tail4(id), supplied: id === supplied,
      template_lookup_ok: t.status === 200, template_lookup_error: t.error,
      lists_sender: a.owns, phone_numbers_http: a.http ?? 200, phone_numbers_error: a.error ?? null,
    });
    if (t.status === 200 && a.owns && !wabaId) { wabaId = id; tpl = t; }
  }
  const waba = {
    resolved: Boolean(wabaId),
    id_suffix: wabaId ? tail4(wabaId) : null,
    source: wabaId ? (wabaId === supplied ? "supplied_id" : wabaId === waAccount ? "whatsapp_account_id" : "token_granted_target") : null,
    candidates_checked: checked,
    hint: wabaId ? null : candidates.length
      ? "No supplied account both serves the aladdin_otp template lookup AND lists this sender. See each candidate's sanitized Graph error. Under Meta's 2026 account model the template (Messaging Account) and the number (WhatsApp Account) may sit under different ids: supply WHATSAPP_BUSINESS_ACCOUNT_ID = the messaging account / WABA id and, if it does not list the number, WHATSAPP_ACCOUNT_ID = the account that does. The token needs whatsapp_business_management on them."
      : "Set WHATSAPP_BUSINESS_ACCOUNT_ID to the WABA / messaging account id (Business settings > Accounts > WhatsApp accounts).",
  };
  const report = {
    read_only: true,
    sender: senderEval,
    sender_id: senderId,
    waba,
    template: wabaId ? evaluateTemplate(tpl.data) : { ok: false, skipped: "no verified account" },
  };
  report.ready_for_pilot = report.sender.ok === true && senderId.matches_repo_config && senderId.echoed_id_matches && waba.resolved && report.template.ok === true;
  log(JSON.stringify(report, null, 2));
  return report.ready_for_pilot ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.env).then((c) => { process.exitCode = c; }, (e) => { console.error(String(e?.message ?? e).slice(0, 200)); process.exitCode = 1; });
}
