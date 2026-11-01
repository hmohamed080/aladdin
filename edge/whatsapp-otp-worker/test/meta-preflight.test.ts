import { test } from "node:test";
import { strict as assert } from "node:assert";
// @ts-expect-error plain .mjs script
import { candidateIds, evaluateSender, evaluateTemplate, run, sanitizeError } from "../scripts/meta-preflight.mjs";
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

/**
 * A tiny Graph that behaves like v25.0 as reported by the live run: `?metadata=1` is DEPRECATED and answers HTTP 400 for every id (so any
 * dependence on it fails), phone-number nodes answer their own fields incl. the echoed `id`, only a template-bearing account answers
 * `/message_templates`, and `/phone_numbers` lists the numbers an account holds. Records every request.
 */
type Req = { url: string; method: string; body?: string; auth?: string };
function graph(opts: {
  templateAccounts?: string[];                       // ids that serve /message_templates
  holders?: Record<string, string[]>;                // account id -> sender ids it lists under /phone_numbers
  phoneNumbersError?: string[];                      // ids whose /phone_numbers errors
  template?: unknown; senderBody?: Record<string, unknown>; senderStatus?: number;
  debugTargets?: string[]; debugStatus?: number; pages?: Record<string, string[][]>;
} = {}) {
  const calls: Req[] = [];
  const templateAccounts = opts.templateAccounts ?? [WABA];
  const holders = opts.holders ?? { [WABA]: [SENDER] };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const err = (status: number, code: number, message: string, sub?: number) => json(status, { error: { message, type: "OAuthException", code, ...(sub ? { error_subcode: sub } : {}), fbtrace_id: "ABCDEFGHIJKLMNOPQRSTUVWX" } });
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), body: init.body as string | undefined, auth: (init.headers as Record<string, string>).authorization });
    assert.ok(!url.includes(TOKEN), "the token must never be in a URL");
    assert.equal((init.headers as Record<string, string>).authorization, `Bearer ${TOKEN}`);
    const path = url.replace("https://graph.facebook.com/v25.0/", "");
    if (path.includes("metadata=1")) return err(400, 100, "Unsupported get request. Node metadata is deprecated in v25.0", 33);
    if (path === "debug_token") { assert.equal(init.method, "POST"); assert.ok(String(init.body).includes("input_token=")); return opts.debugStatus && opts.debugStatus !== 200 ? json(opts.debugStatus, {}) : json(200, { data: { granular_scopes: [{ scope: "whatsapp_business_management", target_ids: opts.debugTargets ?? [WABA] }] } }); }
    assert.equal(init.method, "GET");
    const id = path.split(/[?/]/)[0]!;
    if (path.includes("/phone_numbers")) {
      if (opts.phoneNumbersError?.includes(id)) return err(400, 100, `Unsupported get request. Object with ID '${id}' does not exist, cannot be loaded due to missing permissions`, 33);
      const after = /after=([A-Za-z0-9=_-]+)/.exec(path)?.[1];
      const pages = opts.pages?.[id];
      if (pages) { const i = after ? Number(after.replace("C", "")) : 0; return json(200, { data: pages[i]!.map((x) => ({ id: x })), paging: i + 1 < pages.length ? { cursors: { after: `C${i + 1}` }, next: "https://graph.facebook.com/next" } : { cursors: {} } }); }
      return json(200, { data: (holders[id] ?? []).map((x) => ({ id: x })) });
    }
    if (path.includes("/message_templates")) {
      if (!templateAccounts.includes(id)) return err(400, 100, "Tried accessing nonexisting field (message_templates) on node type (WhatsAppBusinessPhoneNumber)", 33);
      return json(200, opts.template ?? goodTemplate);
    }
    if (id === SENDER) return opts.senderStatus && opts.senderStatus !== 200 ? err(opts.senderStatus, 190, `Invalid OAuth access token ${TOKEN}`) : json(200, { id: SENDER, ...liveSender, ...(opts.senderBody ?? {}) });
    return json(404, {});
  }) as unknown as typeof fetch;
  return { calls, get urls() { return calls.map((c) => c.url); }, fetchImpl };
}
const env = (over: Record<string, string> = {}) => ({ WHATSAPP_ACCESS_TOKEN: TOKEN, WHATSAPP_PHONE_NUMBER_ID: SENDER, WHATSAPP_BUSINESS_ACCOUNT_ID: WABA, ...over });
const optIn = { META_PREFLIGHT_RESOLVE_FROM_TOKEN: "1" };
const runIt = async (e: Record<string, string>, g: ReturnType<typeof graph>, pinned: string | null = SENDER) => {
  const out: string[] = []; const code = await run(e, g.fetchImpl, (l: string) => out.push(l), pinned);
  return { code, text: out.join("\n"), report: out.length && out[out.length - 1]!.startsWith("{") ? JSON.parse(out[out.length - 1]!) : {} };
};

test("v25.0 reality: metadata=1 is never requested; the supplied account is validated by the template lookup and the /phone_numbers listing", async () => {
  const g = graph();
  const r = await runIt(env(), g);
  assert.equal(r.code, 0); assert.equal(r.report.ready_for_pilot, true);
  assert.equal(g.urls.filter((u) => u.includes("metadata")).length, 0, "no deprecated node metadata");
  assert.equal(g.urls.filter((u) => u.includes("debug_token")).length, 0, "no token introspection by default");
  assert.equal(r.report.waba.source, "supplied_id");
  assert.equal(r.report.sender_id.echoed_id_matches, true); assert.equal(r.report.sender_id.matches_repo_config, true);
  assert.ok(g.calls.every((c) => c.method === "GET"));
});

test("exact sender id: an answer that echoes a different id, or a repo pin that differs, is not ready", async () => {
  const echo = await runIt(env(), graph({ senderBody: { id: "999999999999999" } }));
  assert.equal(echo.code, 1); assert.equal(echo.report.sender_id.echoed_id_matches, false); assert.equal(echo.report.sender.checks.exact_id_echo, false);
  const pin = await runIt(env(), graph(), "999999999999999");
  assert.equal(pin.code, 1); assert.equal(pin.report.sender_id.matches_repo_config, false); assert.equal(pin.report.sender_id.repo_config_suffix, "9999");
  assert.equal(pin.report.sender_id.id_suffix, SENDER.slice(-4));
});

test("association is not weakened: an account that serves the template but does NOT list the sender is rejected", async () => {
  const r = await runIt(env(), graph({ holders: { [WABA]: ["111111111111111"] } }));
  assert.equal(r.code, 1); assert.equal(r.report.waba.resolved, false);
  assert.equal(r.report.waba.candidates_checked[0].template_lookup_ok, true); assert.equal(r.report.waba.candidates_checked[0].lists_sender, false);
  assert.equal(r.report.template.skipped, "no verified account");
});

test("an account that lists the sender but cannot serve the template is rejected (the real #100 on a wrong node)", async () => {
  const r = await runIt(env({ WHATSAPP_BUSINESS_ACCOUNT_ID: OTHER_WABA }), graph({ templateAccounts: [], holders: { [OTHER_WABA]: [SENDER] } }));
  assert.equal(r.code, 1);
  const c = r.report.waba.candidates_checked[0];
  assert.equal(c.template_lookup_ok, false); assert.equal(c.lists_sender, true);
  assert.equal(c.template_lookup_error.code, 100); assert.equal(c.template_lookup_error.subcode, 33);
  assert.match(c.template_lookup_error.message, /message_templates/);
});

test("new account model: the number sits on a WhatsApp Account id, the template on the messaging account id; both supplied, the SAME id must do both, so this stays not ready", async () => {
  // template account does not list the number; a different account lists it but serves no templates -> neither id satisfies both
  const g = graph({ templateAccounts: [WABA], holders: { [WABA]: [], [OTHER_WABA]: [SENDER] } });
  const r = await runIt(env({ WHATSAPP_ACCOUNT_ID: OTHER_WABA }), g);
  assert.equal(r.code, 1); assert.equal(r.report.waba.resolved, false);
  assert.equal(r.report.waba.candidates_checked.length, 2);
  assert.match(r.report.waba.hint, /WHATSAPP_ACCOUNT_ID/);
  // legacy-compatible account that does both passes even when a second id is also supplied
  const ok = await runIt(env({ WHATSAPP_ACCOUNT_ID: OTHER_WABA }), graph({ templateAccounts: [WABA, OTHER_WABA], holders: { [WABA]: [SENDER], [OTHER_WABA]: [] } }));
  assert.equal(ok.code, 0); assert.equal(ok.report.waba.id_suffix, WABA.slice(-4));
  // the WhatsApp Account id alone can resolve when it does both
  const wa = await runIt(env({ WHATSAPP_BUSINESS_ACCOUNT_ID: OTHER_WABA, WHATSAPP_ACCOUNT_ID: WABA }), graph({ templateAccounts: [WABA], holders: { [OTHER_WABA]: [], [WABA]: [SENDER] } }));
  assert.equal(wa.code, 0); assert.equal(wa.report.waba.source, "whatsapp_account_id");
});

test("/phone_numbers is paged: a sender on page 2 is found; a never-ending list stops after 5 pages", async () => {
  const pages = { [WABA]: [["1"], ["2"], [SENDER]] };
  assert.equal((await runIt(env(), graph({ pages }))).code, 0);
  const endless = { [WABA]: Array.from({ length: 9 }, (_, i) => [String(1000 + i)]) };
  const g = graph({ pages: endless });
  assert.equal((await runIt(env(), g)).code, 1);
  assert.equal(g.urls.filter((u) => u.includes("/phone_numbers")).length, 5);
});

test("sanitized Graph errors: code / subcode / type / message reported, with no token, number or full id in the output", async () => {
  const g = graph({ phoneNumbersError: [WABA], templateAccounts: [] });
  const r = await runIt(env(), g);
  const c = r.report.waba.candidates_checked[0];
  assert.equal(c.phone_numbers_error.code, 100); assert.equal(c.phone_numbers_error.subcode, 33); assert.equal(c.phone_numbers_error.type, "OAuthException");
  for (const s of [TOKEN, WABA, SENDER, "1012345678", "ABCDEFGHIJKLMNOPQRSTUVWX"]) assert.ok(!r.text.includes(s), "printed " + s.slice(0, 5));
  assert.match(c.phone_numbers_error.message, /\[(id|number)\]/);
  // a sender failure that echoes the token in the message is scrubbed too
  const bad = await runIt(env(), graph({ senderStatus: 401 }));
  assert.equal(bad.report.sender.error.code, 190); assert.ok(!bad.text.includes(TOKEN)); assert.match(bad.report.sender.error.message, /redacted/);
  assert.equal(bad.code, 1);
  assert.equal(sanitizeError({ error: { message: `call +20 10 1234 5678 token ${TOKEN}`, code: 1 } }, TOKEN)!.message.includes("1234"), false);
  assert.equal(sanitizeError(null), null);
});

test("token handling: only in the Authorization header, never a URL; introspection is opt-in, POSTs the token in the BODY, and finds the account when no id is supplied", async () => {
  const g = graph({ debugTargets: [WABA] });
  const r = await runIt({ WHATSAPP_ACCESS_TOKEN: TOKEN, WHATSAPP_PHONE_NUMBER_ID: SENDER, ...optIn }, g);
  assert.equal(r.code, 0); assert.equal(r.report.waba.source, "token_granted_target");
  const dbg = g.calls.filter((c) => c.url.endsWith("/debug_token"));
  assert.equal(dbg.length, 1); assert.equal(dbg[0]!.method, "POST"); assert.ok(dbg[0]!.body!.includes("input_token="));
  assert.ok(g.calls.every((c) => !c.url.includes(TOKEN) && c.auth === `Bearer ${TOKEN}`));
  const none = await runIt({ WHATSAPP_ACCESS_TOKEN: TOKEN, WHATSAPP_PHONE_NUMBER_ID: SENDER }, graph());
  assert.equal(none.code, 1); assert.match(none.report.waba.hint, /WHATSAPP_BUSINESS_ACCOUNT_ID/);
  assert.equal((await runIt({ WHATSAPP_ACCESS_TOKEN: TOKEN, WHATSAPP_PHONE_NUMBER_ID: SENDER, ...optIn }, graph({ debugStatus: 400 }))).code, 1);
});

test("candidate ids: supplied first, then the token's WhatsApp grants only, de-duplicated and numeric", () => {
  const ids = candidateIds(WABA, { data: { granular_scopes: [{ scope: "whatsapp_business_management", target_ids: [WABA, OTHER_WABA] }, { scope: "business_management", target_ids: [BUSINESS] }, { scope: "whatsapp_business_messaging", target_ids: ["not-numeric"] }] } });
  assert.deepEqual(ids, [WABA, OTHER_WABA]);
  assert.deepEqual(candidateIds(undefined, null), []);
});

test("an incompatible template (ONE_TAP) on a correctly validated account is not ready", async () => {
  const r = await runIt(env(), graph({ template: { data: [{ ...goodTemplate.data[0], components: comps({ buttons: [{ type: "OTP", otp_type: "ONE_TAP" }] }) }] } }));
  assert.equal(r.code, 1); assert.equal(r.report.template.checks.button_is_copy_code, false);
});

test("read-only and quiet: GETs only, nothing sensitive printed, missing or malformed inputs call nothing", async () => {
  const g = graph(); const r = await runIt(env(), g);
  assert.ok(g.urls.every((u) => u.startsWith("https://graph.facebook.com/v25.0/")));
  for (const s of [TOKEN, "1012345678", SENDER, WABA, BUSINESS]) assert.ok(!r.text.includes(s), "printed " + s.slice(0, 5));
  let n = 0; const out: string[] = []; const never = (async () => { n++; return new Response("{}"); }) as unknown as typeof fetch;
  assert.equal(await run({}, never, (l: string) => out.push(l)), 3);
  assert.equal(await run({ WHATSAPP_ACCESS_TOKEN: TOKEN, WHATSAPP_PHONE_NUMBER_ID: "abc" }, never, () => {}), 2);
  assert.equal(await run({ WHATSAPP_ACCESS_TOKEN: TOKEN, WHATSAPP_PHONE_NUMBER_ID: SENDER, WHATSAPP_ACCOUNT_ID: "x" }, never, () => {}), 2);
  assert.equal(n, 0);
});
