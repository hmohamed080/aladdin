#!/usr/bin/env node
// READ-ONLY Meta WhatsApp Cloud API preflight. Sends NOTHING, creates nothing, changes nothing: GET requests to graph.facebook.com only.
//
//   WHATSAPP_ACCESS_TOKEN=<token> WHATSAPP_PHONE_NUMBER_ID=<sender id> [WHATSAPP_BUSINESS_ACCOUNT_ID=<candidate WABA id>] \
//     node edge/whatsapp-otp-worker/scripts/meta-preflight.mjs
//
// Run it in your own shell from your secret store; never paste a token into a chat. It prints booleans, enums and the LAST FOUR digits of ids
// only - never the token, never a template body, never a recipient. Exit 0 only when every check passes.
//
// WABA RESOLUTION (why this exists): `message_templates` is a field of the WhatsApp Business ACCOUNT (WABA) node only. Asking a phone-number
// or business-portfolio id for it fails with Graph error #100 ("Tried accessing nonexisting field (message_templates)"). So the script never
// assumes which id it was given. It collects candidates (the id you supplied, then every target the token itself was granted through
// `debug_token`), asks Graph what TYPE each node is (`?metadata=1`), keeps only WhatsAppBusinessAccount nodes, and then requires that the WABA
// actually OWNS the sender (`/{waba}/phone_numbers` contains it). Only that verified WABA is used for the template lookup.
//
// Answers: is the sender a LIVE, connected, verified business number; is `aladdin_otp` an APPROVED AUTHENTICATION template in Arabic with
// exactly one COPY_CODE button (the shape the Worker's payload fills) and an expiry equal to the authority's code lifetime (5 minutes).
import { pathToFileURL } from "node:url";

const GRAPH = "https://graph.facebook.com";
const VERSION = "v25.0";
/** The authority's challenge_ttl default and the transport's ttlSeconds (300): the template's "expires in N minutes" must not lie. */
export const EXPECTED_EXPIRY_MINUTES = 5;
const WABA_TYPE = "WhatsAppBusinessAccount";

export function evaluateSender(p) {
  const checks = {
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

const tail4 = (id) => String(id).slice(-4);
/** Candidate ids, in order: the supplied one, then every target the token was granted for WhatsApp management/messaging. De-duplicated. */
export function candidateIds(suppliedId, debugData) {
  const granted = (debugData?.data?.granular_scopes ?? [])
    .filter((s) => /^whatsapp_business_(management|messaging)$/.test(String(s?.scope)))
    .flatMap((s) => Array.isArray(s.target_ids) ? s.target_ids.map(String) : []);
  return [...new Set([suppliedId, ...granted].filter((x) => /^\d{5,30}$/.test(String(x ?? ""))))];
}

export async function run(env, fetchImpl = fetch, log = console.log) {
  const need = ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"].filter((k) => !env[k]);
  if (need.length) { log("NOT RUN - missing: " + need.join(", ") + ". Nothing was called."); return 3; }
  const supplied = env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  if (!/^\d{5,30}$/.test(env.WHATSAPP_PHONE_NUMBER_ID) || (supplied && !/^\d{5,30}$/.test(supplied))) { log("NOT RUN - ids must be numeric."); return 2; }
  const ALLOWED = [
    /^\d+\?fields=[a-z_,]+$/,                                   // the sender's own fields
    /^\d+\?metadata=1&fields=id$/,                              // what TYPE of node is this id
    /^\d+\/phone_numbers\?fields=id$/,                          // which senders a WABA owns
    /^\d+\/message_templates\?name=aladdin_otp&fields=[a-z_,]+$/, // WABA nodes only
    /^debug_token\?input_token=[A-Za-z0-9_|.\-]+$/,             // the token's own granted targets (read-only introspection)
  ];
  const get = async (path) => {
    if (!ALLOWED.some((re) => re.test(path))) throw new Error("REFUSED: not an allowed read-only call");
    const r = await fetchImpl(`${GRAPH}/${VERSION}/${path}`, { method: "GET", headers: { authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` } });
    return { status: r.status, data: await r.json().catch(() => null) };
  };

  const sender = await get(`${env.WHATSAPP_PHONE_NUMBER_ID}?fields=display_phone_number,status,account_mode,code_verification_status,name_status,quality_rating`);

  // ---- resolve and validate the WABA ----
  const debug = await get(`debug_token?input_token=${env.WHATSAPP_ACCESS_TOKEN}`).catch(() => ({ status: 0, data: null }));
  const candidates = candidateIds(supplied, debug.status === 200 ? debug.data : null);
  const checked = [];
  let wabaId = null;
  for (const id of candidates) {
    const node = await get(`${id}?metadata=1&fields=id`);
    const type = node.status === 200 ? String(node.data?.metadata?.type ?? "unknown") : `http_${node.status}`;
    const entry = { id_suffix: tail4(id), type, is_waba: type === WABA_TYPE, owns_sender: false, supplied: id === supplied };
    if (entry.is_waba) {
      const owned = await get(`${id}/phone_numbers?fields=id`);
      entry.owns_sender = owned.status === 200 && (owned.data?.data ?? []).some((p) => String(p?.id) === env.WHATSAPP_PHONE_NUMBER_ID);
      if (entry.owns_sender && !wabaId) wabaId = id;
    }
    checked.push(entry);
  }
  const waba = {
    resolved: Boolean(wabaId),
    id_suffix: wabaId ? tail4(wabaId) : null,
    source: wabaId ? (wabaId === supplied ? "supplied_id" : "token_granted_target") : null,
    candidates_checked: checked,
    supplied_id_was_waba: supplied ? checked.find((c) => c.supplied)?.is_waba ?? false : null,
    hint: wabaId ? null : "No WhatsApp Business Account that owns this sender could be resolved. The token needs whatsapp_business_management access to the WABA that owns the sender (Business settings > System users > assign the WABA asset).",
  };

  const tpl = wabaId
    ? await get(`${wabaId}/message_templates?name=aladdin_otp&fields=name,language,status,category,components`)
    : { status: 0, data: null };
  const report = {
    read_only: true,
    sender: sender.status === 200 ? evaluateSender(sender.data) : { ok: false, http: sender.status },
    waba,
    template: wabaId ? (tpl.status === 200 ? evaluateTemplate(tpl.data) : { ok: false, http: tpl.status }) : { ok: false, skipped: "no verified WABA" },
  };
  report.ready_for_pilot = report.sender.ok === true && waba.resolved && report.template.ok === true;
  log(JSON.stringify(report, null, 2));
  return report.ready_for_pilot ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.env).then((c) => { process.exitCode = c; }, (e) => { console.error(String(e?.message ?? e).slice(0, 200)); process.exitCode = 1; });
}
