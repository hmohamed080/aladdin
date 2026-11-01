import { test } from "node:test";
import { strict as assert } from "node:assert";
// @ts-expect-error plain .mjs script
import { candidateIds, evaluateSender, evaluateTemplate, run } from "../scripts/meta-preflight.mjs";
import { buildMetaPayload } from "../src/index.ts";

const SENDER = "1415528588305492";
const WABA = "987654321098765";
const OTHER_WABA = "555555555555555";
const BUSINESS = "111122223333444";
const TOKEN = "TOKEN-SECRET-VALUE";

const liveSender = { display_phone_number: "+20 10 1234 5678", status: "CONNECTED", account_mode: "LIVE", code_verification_status: "VERIFIED", name_status: "APPROVED", quality_rating: "GREEN" };
const comps = (over: Record<string, unknown> = {}) => [
  { type: "BODY" },
  { type: "FOOTER", code_expiration_minutes: 5, ...(over.footer as object) },
  { type: "BUTTONS", buttons: (over.buttons as unknown[]) ?? [{ type: "OTP", otp_type: "COPY_CODE" }] },
];
const goodTemplate = { data: [{ name: "aladdin_otp", language: "ar", status: "APPROVED", category: "AUTHENTICATION", components: comps() }] };

test("a live, connected, verified sender passes; a sandbox/test or unverified sender does not", () => {
  assert.equal(evaluateSender(liveSender).ok, true);
  assert.equal(evaluateSender({ ...liveSender, account_mode: "SANDBOX" }).checks.live_not_sandbox, false);
  assert.equal(evaluateSender({ ...liveSender, status: "PENDING" }).ok, false);
  assert.equal(evaluateSender({ ...liveSender, code_verification_status: "NOT_VERIFIED" }).ok, false);
  assert.equal(evaluateSender({ ...liveSender, quality_rating: "RED" }).ok, false);
  assert.equal(evaluateSender(liveSender).display_suffix, "5678");
});

test("only an APPROVED Arabic AUTHENTICATION template with exactly one COPY_CODE button and a 5-minute expiry passes", () => {
  assert.equal(evaluateTemplate(goodTemplate).ok, true);
  const mk = (over: object, c = comps()) => ({ data: [{ ...goodTemplate.data[0], ...over, components: c }] });
  assert.equal(evaluateTemplate(mk({ status: "PENDING" })).ok, false);
  assert.equal(evaluateTemplate(mk({ category: "MARKETING" })).ok, false);
  assert.equal(evaluateTemplate(mk({ language: "en" })).checks.exists_in_language, false);
  for (const otp_type of ["ONE_TAP", "ZERO_TAP", undefined]) {
    const t = evaluateTemplate(mk({}, comps({ buttons: [{ type: "OTP", otp_type }] })));
    assert.equal(t.ok, false, String(otp_type)); assert.equal(t.checks.button_is_copy_code, false);
  }
  assert.equal(evaluateTemplate(mk({}, comps({ buttons: [{ type: "URL" }] }))).ok, false);
  assert.equal(evaluateTemplate(mk({}, comps({ buttons: [{ type: "OTP", otp_type: "COPY_CODE" }, { type: "QUICK_REPLY" }] }))).checks.has_exactly_one_button, false);
  // the template promises "expires in N minutes": it must equal the authority's 5-minute code lifetime
  assert.equal(evaluateTemplate(mk({}, comps({ footer: { code_expiration_minutes: 10 } }))).checks.expiry_matches_authority, false);
  assert.equal(evaluateTemplate(mk({}, [{ type: "BODY" }, { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE" }] }])).checks.expiry_matches_authority, false);
  assert.equal(evaluateTemplate({ data: [] }).ok, false);
});

test("the Worker's send payload IS the Meta Copy Code authentication contract (golden): body param + button sub_type url index 0, nothing else", () => {
  // Meta's documented send shape for an Authentication template with a Copy Code button.
  const golden = {
    messaging_product: "whatsapp", to: "201012345678", type: "template",
    template: { name: "aladdin_otp", language: { code: "ar" }, components: [
      { type: "body", parameters: [{ type: "text", text: "123456" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "123456" }] },
    ] },
  };
  assert.deepEqual(buildMetaPayload("+201012345678", "123456", "aladdin_otp", "ar"), golden);
});

/** A tiny Graph: node types, ownership, token grants, templates. Records every URL requested. */
function graph(opts: { debugTargets?: string[]; types?: Record<string, string>; owns?: Record<string, string[]>; template?: unknown; debugStatus?: number } = {}) {
  const urls: string[] = [];
  const types = opts.types ?? { [SENDER]: "WhatsAppBusinessPhoneNumber", [WABA]: "WhatsAppBusinessAccount", [BUSINESS]: "Business" };
  const owns = opts.owns ?? { [WABA]: [SENDER] };
  const fetchImpl = (async (url: string, init: RequestInit) => {
    urls.push(url);
    const path = url.replace("https://graph.facebook.com/v25.0/", "");
    // the token must never be in a URL; only the opt-in introspection may POST, and then with the token in the BODY
    assert.ok(!url.includes(TOKEN), "token leaked into a URL");
    assert.equal((init.headers as Record<string, string>).authorization, `Bearer ${TOKEN}`);
    if (path.startsWith("debug_token")) { assert.equal(init.method, "POST"); assert.equal(path, "debug_token"); assert.ok(String(init.body).includes("input_token=")); }
    else assert.equal(init.method, "GET");
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (path.startsWith("debug_token")) return opts.debugStatus && opts.debugStatus !== 200 ? json(opts.debugStatus, {}) : json(200, { data: { granular_scopes: [{ scope: "whatsapp_business_management", target_ids: opts.debugTargets ?? [WABA] }, { scope: "business_management", target_ids: [BUSINESS] }] } });
    const id = path.split(/[?/]/)[0]!;
    if (path.includes("metadata=1")) return types[id] ? json(200, { id, metadata: { type: types[id] } }) : json(400, { error: { code: 100 } });
    if (path.includes("/phone_numbers")) return json(200, { data: (owns[id] ?? []).map((x) => ({ id: x })) });
    if (path.includes("/message_templates")) {
      // the real-world failure: only a WABA node has this field
      if (types[id] !== "WhatsAppBusinessAccount") return json(400, { error: { code: 100, message: "Tried accessing nonexisting field (message_templates)" } });
      return json(200, opts.template ?? goodTemplate);
    }
    if (id === SENDER) return json(200, liveSender);
    return json(404, {});
  }) as unknown as typeof fetch;
  return { urls, fetchImpl };
}
const env = (over: Record<string, string> = {}) => ({ WHATSAPP_ACCESS_TOKEN: TOKEN, WHATSAPP_PHONE_NUMBER_ID: SENDER, ...over });
const optIn = { META_PREFLIGHT_RESOLVE_FROM_TOKEN: "1" };
const runIt = async (e: Record<string, string>, g: ReturnType<typeof graph>, pinned: string | null = SENDER) => { const out: string[] = []; const code = await run(e, g.fetchImpl, (l: string) => out.push(l), pinned); return { code, text: out.join("\n"), report: out.length ? JSON.parse(out[out.length - 1]!.startsWith("{") ? out[out.length - 1]! : "{}") : {} }; };

test("candidate ids: the supplied id first, then the token's own WhatsApp grants (not unrelated scopes), de-duplicated and numeric only", () => {
  const ids = candidateIds(WABA, { data: { granular_scopes: [{ scope: "whatsapp_business_management", target_ids: [WABA, OTHER_WABA] }, { scope: "business_management", target_ids: [BUSINESS] }, { scope: "whatsapp_business_messaging", target_ids: ["not-numeric"] }] } });
  assert.deepEqual(ids, [WABA, OTHER_WABA]);
  assert.deepEqual(candidateIds(undefined, null), []);
});

test("the #100 case: a phone-number id given as the 'business account' is detected as the wrong node type and the real WABA is resolved from the token's own grants", async () => {
  const g = graph();
  const r = await runIt(env({...optIn,  WHATSAPP_BUSINESS_ACCOUNT_ID: SENDER }), g);
  assert.equal(r.code, 0);
  assert.equal(r.report.waba.resolved, true);
  assert.equal(r.report.waba.source, "token_granted_target");
  assert.equal(r.report.waba.supplied_id_was_waba, false);
  assert.equal(r.report.waba.candidates_checked.find((c: { supplied: boolean }) => c.supplied).type, "WhatsAppBusinessPhoneNumber");
  // the template lookup went ONLY to the verified WABA, never to the phone-number id
  const templateCalls = g.urls.filter((u) => u.includes("message_templates"));
  assert.equal(templateCalls.length, 1);
  assert.ok(templateCalls[0]!.includes(`/${WABA}/`) && !templateCalls[0]!.includes(`/${SENDER}/`));
});

test("works with no id supplied at all (resolved from the token), and with the correct WABA supplied", async () => {
  assert.equal((await runIt(env(optIn), graph())).report.waba.source, "token_granted_target");
  const s = await runIt(env({ WHATSAPP_BUSINESS_ACCOUNT_ID: WABA }), graph());
  assert.equal(s.code, 0); assert.equal(s.report.waba.source, "supplied_id"); assert.equal(s.report.waba.supplied_id_was_waba, true);
});

test("a WABA that does not OWN the sender is rejected (another WABA's template is not evidence); the right one is chosen among several", async () => {
  const types = { [SENDER]: "WhatsAppBusinessPhoneNumber", [WABA]: "WhatsAppBusinessAccount", [OTHER_WABA]: "WhatsAppBusinessAccount", [BUSINESS]: "Business" };
  const g = graph({ debugTargets: [OTHER_WABA, WABA], types, owns: { [OTHER_WABA]: [], [WABA]: [SENDER] } });
  const r = await runIt(env({...optIn,  WHATSAPP_BUSINESS_ACCOUNT_ID: OTHER_WABA }), g);
  assert.equal(r.code, 0); assert.equal(r.report.waba.id_suffix, WABA.slice(-4));
  assert.equal(r.report.waba.candidates_checked.find((c: { id_suffix: string }) => c.id_suffix === OTHER_WABA.slice(-4)).owns_sender, false);
  const none = await runIt(env(optIn), graph({ debugTargets: [OTHER_WABA], types, owns: { [OTHER_WABA]: [] } }));
  assert.equal(none.code, 1); assert.equal(none.report.waba.resolved, false); assert.match(none.report.waba.hint, /whatsapp_business_management/);
  assert.equal(none.report.template.skipped, "no verified WABA");
});

test("when the token cannot introspect itself and the supplied id is not a WABA: not ready, no template call, a clear hint", async () => {
  const g = graph({ debugStatus: 400 });
  const r = await runIt(env({...optIn,  WHATSAPP_BUSINESS_ACCOUNT_ID: SENDER }), g);
  assert.equal(r.code, 1); assert.equal(r.report.waba.resolved, false);
  assert.equal(g.urls.filter((u) => u.includes("message_templates")).length, 0);
});

test("an incompatible template (ONE_TAP) on a correctly resolved WABA is not ready", async () => {
  const g = graph({ template: { data: [{ ...goodTemplate.data[0], components: comps({ buttons: [{ type: "OTP", otp_type: "ONE_TAP" }] }) }] } });
  const r = await runIt(env(optIn), g);
  assert.equal(r.code, 1); assert.equal(r.report.template.checks.button_is_copy_code, false);
});

test("read-only and quiet: GETs only to graph.facebook.com, nothing sensitive printed (token, number, full ids), missing inputs call nothing", async () => {
  const g = graph(); const r = await runIt(env({ WHATSAPP_BUSINESS_ACCOUNT_ID: WABA }), g);
  assert.ok(g.urls.every((u) => u.startsWith("https://graph.facebook.com/v25.0/")));
  for (const s of [TOKEN, "1012345678", SENDER, WABA, BUSINESS]) assert.ok(!r.text.includes(s), "printed " + s.slice(0, 5));
  let n = 0; const out: string[] = [];
  assert.equal(await run({}, (async () => { n++; return new Response("{}"); }) as unknown as typeof fetch, (l: string) => out.push(l)), 3);
  assert.equal(n, 0);
  assert.equal(await run({ WHATSAPP_ACCESS_TOKEN: TOKEN, WHATSAPP_PHONE_NUMBER_ID: "abc" }, (async () => { n++; return new Response("{}"); }) as unknown as typeof fetch, () => {}), 2);
  assert.equal(n, 0);
});

test("default: the token is never sent to debug_token; the WABA id is verified by node type and ownership instead", async () => {
  const g = graph();
  const r = await runIt(env({ WHATSAPP_BUSINESS_ACCOUNT_ID: WABA }), g);
  assert.equal(r.code, 0);
  assert.equal(g.urls.filter((u) => u.includes("debug_token")).length, 0);
  assert.ok(g.urls.every((u) => !u.includes(TOKEN)));
  const noId = await runIt(env(), graph());
  assert.equal(noId.code, 1); assert.match(noId.report.waba.hint, /WHATSAPP_BUSINESS_ACCOUNT_ID/);
});

test("sender id: must be a phone-number NODE and equal the id pinned in wrangler.jsonc; a phone number or a WABA id is refused", async () => {
  const ok = await runIt(env({ WHATSAPP_BUSINESS_ACCOUNT_ID: WABA }), graph());
  assert.equal(ok.report.sender_id.is_phone_number_node, true); assert.equal(ok.report.sender_id.matches_repo_config, true);
  // repo pins a different id than the one the owner's live sender has -> not ready, both suffixes shown
  const mismatch = await runIt(env({ WHATSAPP_BUSINESS_ACCOUNT_ID: WABA }), graph(), "999999999999999");
  assert.equal(mismatch.code, 1); assert.equal(mismatch.report.sender_id.matches_repo_config, false); assert.equal(mismatch.report.sender_id.repo_config_suffix, "9999");
  // the id given is actually a WABA -> wrong node type
  const g = graph({ types: { [SENDER]: "WhatsAppBusinessAccount", [WABA]: "WhatsAppBusinessAccount" }, owns: { [WABA]: [SENDER] } });
  const wrongType = await runIt(env({ WHATSAPP_BUSINESS_ACCOUNT_ID: WABA }), g);
  assert.equal(wrongType.code, 1); assert.equal(wrongType.report.sender_id.is_phone_number_node, false);
  assert.ok(!mismatch.text.includes(SENDER));
});
