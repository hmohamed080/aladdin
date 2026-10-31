#!/usr/bin/env node
// READ-ONLY Meta WhatsApp Cloud API preflight. Sends NOTHING and changes nothing: two GET requests to graph.facebook.com.
//
//   WHATSAPP_ACCESS_TOKEN=<token> WHATSAPP_PHONE_NUMBER_ID=<id> WHATSAPP_BUSINESS_ACCOUNT_ID=<waba id> \
//     node edge/whatsapp-otp-worker/scripts/meta-preflight.mjs
//
// Run it in your own shell from your secret store; never paste a token into a chat. It prints booleans, enums and the LAST FOUR digits of
// the sender number only - never the token, never a template body, never a recipient. Exit 0 only when every check passes.
//
// Answers: is the sender a LIVE, connected, verified business number (not a Meta sandbox/test number), and is `aladdin_otp` an APPROVED
// AUTHENTICATION template in Arabic with the copy-code (OTP) button the Worker's payload fills in.
import { pathToFileURL } from "node:url";

const GRAPH = "https://graph.facebook.com";
const VERSION = "v25.0";

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
  const buttons = comps.find((c) => c.type === "BUTTONS")?.buttons ?? [];
  const checks = {
    exists_in_language: Boolean(t),
    approved: t?.status === "APPROVED",
    authentication_category: t?.category === "AUTHENTICATION",
    // The Worker fills body parameter 1 and button index 0 (sub_type "url") with the code: the template must have exactly that shape.
    has_body: Boolean(body),
    // EXACTLY one button, and it must be the COPY_CODE button. The Worker's payload fills body param 1 and button index 0 with the code, which is
    // the Copy Code contract. ONE_TAP / ZERO_TAP buttons need Android package + signature-hash parameters the Worker never sends, so a template
    // with one of those would be accepted by this check yet fail (or mis-render) on a real handset: they are refused here on purpose.
    has_exactly_one_button: buttons.length === 1,
    button_is_copy_code: buttons.length === 1 && buttons[0].type === "OTP" && buttons[0].otp_type === "COPY_CODE",
  };
  return { checks, ok: Object.values(checks).every(Boolean), status: t?.status ?? null, category: t?.category ?? null };
}

export async function run(env, fetchImpl = fetch, log = console.log) {
  const need = ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID"].filter((k) => !env[k]);
  if (need.length) { log("NOT RUN - missing: " + need.join(", ") + ". Nothing was called."); return 3; }
  if (!/^\d{5,30}$/.test(env.WHATSAPP_PHONE_NUMBER_ID) || !/^\d{5,30}$/.test(env.WHATSAPP_BUSINESS_ACCOUNT_ID)) { log("NOT RUN - ids must be numeric."); return 2; }
  const get = async (path) => {
    const url = `${GRAPH}/${VERSION}/${path}`;
    // only these two read-only shapes ever leave the process
    if (!/^\d+\?fields=[a-z_,]+$/.test(path) && !/^\d+\/message_templates\?name=aladdin_otp&fields=[a-z_,]+$/.test(path)) throw new Error("REFUSED: not an allowed read-only call");
    const r = await fetchImpl(url, { method: "GET", headers: { authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` } });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const sender = await get(`${env.WHATSAPP_PHONE_NUMBER_ID}?fields=display_phone_number,status,account_mode,code_verification_status,name_status,quality_rating`);
  const tpl = await get(`${env.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates?name=aladdin_otp&fields=name,language,status,category,components`);
  const report = {
    read_only: true,
    sender: sender.status === 200 ? evaluateSender(sender.data) : { ok: false, http: sender.status },
    template: tpl.status === 200 ? evaluateTemplate(tpl.data) : { ok: false, http: tpl.status },
  };
  report.ready_for_pilot = report.sender.ok === true && report.template.ok === true;
  log(JSON.stringify(report, null, 2));
  return report.ready_for_pilot ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.env).then((c) => { process.exitCode = c; }, (e) => { console.error(String(e?.message ?? e).slice(0, 200)); process.exitCode = 1; });
}
