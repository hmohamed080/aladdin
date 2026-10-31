import { test } from "node:test";
import { strict as assert } from "node:assert";
// @ts-expect-error plain .mjs script
import { evaluateSender, evaluateTemplate, run } from "../scripts/meta-preflight.mjs";

const liveSender = { display_phone_number: "+20 10 1234 5678", status: "CONNECTED", account_mode: "LIVE", code_verification_status: "VERIFIED", name_status: "APPROVED", quality_rating: "GREEN" };
const goodTemplate = { data: [{ name: "aladdin_otp", language: "ar", status: "APPROVED", category: "AUTHENTICATION", components: [{ type: "BODY" }, { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE" }] }] }] };

test("a live, connected, verified sender passes; a sandbox/test or unverified sender does not", () => {
  assert.equal(evaluateSender(liveSender).ok, true);
  assert.equal(evaluateSender({ ...liveSender, account_mode: "SANDBOX" }).checks.live_not_sandbox, false);
  assert.equal(evaluateSender({ ...liveSender, status: "PENDING" }).ok, false);
  assert.equal(evaluateSender({ ...liveSender, code_verification_status: "NOT_VERIFIED" }).ok, false);
  assert.equal(evaluateSender({ ...liveSender, quality_rating: "RED" }).ok, false);
  assert.equal(evaluateSender(liveSender).display_suffix, "5678");
});
test("only an APPROVED Arabic AUTHENTICATION template with a copy-code button passes", () => {
  assert.equal(evaluateTemplate(goodTemplate).ok, true);
  assert.equal(evaluateTemplate({ data: [{ ...goodTemplate.data[0], status: "PENDING" }] }).ok, false);
  assert.equal(evaluateTemplate({ data: [{ ...goodTemplate.data[0], category: "MARKETING" }] }).ok, false);
  assert.equal(evaluateTemplate({ data: [{ ...goodTemplate.data[0], language: "en" }] }).checks.exists_in_language, false);
  assert.equal(evaluateTemplate({ data: [{ ...goodTemplate.data[0], components: [{ type: "BODY" }] }] }).checks.button_is_copy_code, false);
  // incompatible OTP button types are refused: only Copy Code matches the payload the Worker sends
  for (const otp_type of ["ONE_TAP", "ZERO_TAP", undefined]) {
    const t = evaluateTemplate({ data: [{ ...goodTemplate.data[0], components: [{ type: "BODY" }, { type: "BUTTONS", buttons: [{ type: "OTP", otp_type }] }] }] });
    assert.equal(t.ok, false, String(otp_type)); assert.equal(t.checks.button_is_copy_code, false);
  }
  // a non-OTP button, or COPY_CODE next to another button, is refused too
  assert.equal(evaluateTemplate({ data: [{ ...goodTemplate.data[0], components: [{ type: "BODY" }, { type: "BUTTONS", buttons: [{ type: "URL" }] }] }] }).ok, false);
  assert.equal(evaluateTemplate({ data: [{ ...goodTemplate.data[0], components: [{ type: "BODY" }, { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE" }, { type: "QUICK_REPLY" }] }] }] }).checks.has_exactly_one_button, false);
  assert.equal(evaluateTemplate({ data: [] }).ok, false);
});
test("run: two GETs only, no token or full number in the output, exit 0 only when ready; missing inputs call nothing", async () => {
  const calls: Array<{ url: string; method: string }> = []; const out: string[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url, method: String(init.method) }); return new Response(JSON.stringify(url.includes("message_templates") ? goodTemplate : liveSender)); }) as unknown as typeof fetch;
  const env = { WHATSAPP_ACCESS_TOKEN: "TOKEN-SECRET-VALUE", WHATSAPP_PHONE_NUMBER_ID: "1415528588305492", WHATSAPP_BUSINESS_ACCOUNT_ID: "123456789012345" };
  assert.equal(await run(env, f, (l: string) => out.push(l)), 0);
  assert.equal(calls.length, 2); assert.ok(calls.every((c) => c.method === "GET" && c.url.startsWith("https://graph.facebook.com/")));
  const text = out.join("\n");
  for (const s of ["TOKEN-SECRET-VALUE", "1012345678", "1415528588305492"]) assert.ok(!text.includes(s));
  const none: string[] = []; let n = 0;
  assert.equal(await run({}, (async () => { n++; return new Response("{}"); }) as unknown as typeof fetch, (l: string) => none.push(l)), 3);
  assert.equal(n, 0);
  const sandbox = (async (url: string) => new Response(JSON.stringify(url.includes("message_templates") ? goodTemplate : { ...liveSender, account_mode: "SANDBOX" }))) as unknown as typeof fetch;
  assert.equal(await run(env, sandbox, () => {}), 1);
});
