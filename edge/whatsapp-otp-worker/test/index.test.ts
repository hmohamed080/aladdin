import { test } from "node:test";
import { strict as assert } from "node:assert";
import { handleRequest, verifySignature, parseEvent } from "../src/index.ts";

const secret = "v1,whsec_" + btoa("A".repeat(32));
const env = {
  SUPABASE_SEND_SMS_HOOK_SECRET: secret,
  WHATSAPP_ACCESS_TOKEN: { get: async () => "do-not-log" },
  WHATSAPP_PHONE_NUMBER_ID: "141552388305492",
  WHATSAPP_OTP_TEMPLATE: "aladdin_otp",
  WHATSAPP_OTP_LANGUAGE: "ar",
  WHATSAPP_GRAPH_API_VERSION: "v25.0",
  WHATSAPP_DELIVERY_ENABLED: "false",
};
const event = JSON.stringify({ user: { phone: "+201012345678" }, sms: { otp: "123456" } });

async function signedRequest(body: string, valid = true, offsetSeconds = 0): Promise<Request> {
  const id = "msg_test_123";
  const timestamp = String(Math.floor(Date.now() / 1000) + offsetSeconds);
  const keyBytes = Uint8Array.from(atob(secret.slice(9)), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(id + "." + timestamp + "." + body));
  const mac = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return new Request("https://preview.example/hooks/supabase/send-sms", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": valid ? "v1," + mac : "v1,invalid",
    },
    body,
  });
}

test("accepts correctly signed raw hook", async () => {
  const req = await signedRequest(event);
  assert.equal(await verifySignature(event, req.headers, secret), true);
});
test("rejects altered signature and never calls Meta", async () => {
  let calls = 0;
  const result = await handleRequest(await signedRequest(event, false), { ...env, WHATSAPP_DELIVERY_ENABLED: "true" }, (async () => {
    calls++; return new Response();
  }) as typeof fetch);
  assert.equal(result.status, 401);
  assert.equal(calls, 0);
});
test("rejects expired signed hooks", async () => {
  const result = await handleRequest(await signedRequest(event, true, -600), env);
  assert.equal(result.status, 401);
});
test("delivery disabled is fail-closed even with valid signed request", async () => {
  let calls = 0;
  const result = await handleRequest(await signedRequest(event), env, (async () => {
    calls++; return new Response();
  }) as typeof fetch);
  assert.equal(result.status, 503);
  assert.equal(calls, 0);
});
test("does not read account secret while delivery is disabled", async () => {
  let reads = 0;
  const guarded = {
    ...env,
    WHATSAPP_ACCESS_TOKEN: { get: async () => { reads++; return "unexpected"; } },
  };
  const result = await handleRequest(await signedRequest(event), guarded);
  assert.equal(result.status, 503);
  assert.equal(reads, 0);
});
test("missing Secrets Store secret refuses to contact Meta", async () => {
  let calls = 0;
  const guarded = {
    ...env, WHATSAPP_DELIVERY_ENABLED: "true",
    WHATSAPP_ACCESS_TOKEN: { get: async () => "" },
  };
  const result = await handleRequest(await signedRequest(event), guarded, (async () => {
    calls++; return new Response(JSON.stringify({ messages: [{ id: "wrong" }] }), { status: 200 });
  }) as typeof fetch);
  assert.equal(result.status, 502);
  assert.equal(calls, 0);
});
test("sends copy-code Arabic template once with matching body and button", async () => {
  let calls = 0;
  const result = await handleRequest(await signedRequest(event), { ...env, WHATSAPP_DELIVERY_ENABLED: "true" }, (async (url, init) => {
    calls++;
    assert.equal(String(url), "https://graph.facebook.com/v25.0/141552388305492/messages");
    const sent = JSON.parse(String(init?.body));
    assert.equal(sent.to, "201012345678");
    assert.equal(sent.template.name, "aladdin_otp");
    assert.equal(sent.template.language.code, "ar");
    assert.equal(sent.template.components[0].parameters[0].text, "123456");
    assert.equal(sent.template.components[1].parameters[0].text, "123456");
    assert.equal(sent.template.components[1].sub_type, "url");
    return new Response(JSON.stringify({ messages: [{ id: "wamid.mock" }] }), { status: 200 });
  }) as typeof fetch);
  assert.equal(result.status, 200);
  assert.equal(calls, 1);
});
test("rejects wrong phone and malformed OTP", () => {
  assert.equal(parseEvent(JSON.stringify({ user: { phone: "01012345678" }, sms: { otp: "123456" } })), null);
  assert.equal(parseEvent(JSON.stringify({ user: { phone: "+201012345678" }, sms: { otp: "12345" } })), null);
  assert.equal(parseEvent("bad json"), null);
});
test("does not leak Meta errors or OTPs", async () => {
  const r = await handleRequest(await signedRequest(event), { ...env, WHATSAPP_DELIVERY_ENABLED: "true" }, (async () =>
    new Response(JSON.stringify({ error: { message: "do-not-log" } }), { status: 400 })
  ) as typeof fetch);
  assert.equal(r.status, 502);
  const body = await r.text();
  assert.equal(body.includes("123456"), false);
  assert.equal(body.includes("do-not-log"), false);
});
