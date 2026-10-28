import { test } from "node:test";
import { strict as assert } from "node:assert";
import { handleRequest, verifySignature, parseEvent, type ReplayDb } from "../src/index.ts";

const secret = "v1,whsec_" + btoa("A".repeat(32));
const env = {
  SUPABASE_SEND_SMS_HOOK_SECRET: { get: async () => secret },
  WHATSAPP_ACCESS_TOKEN: { get: async () => "do-not-log" },
  WHATSAPP_PHONE_NUMBER_ID: "1415528588305492",
  WHATSAPP_OTP_TEMPLATE: "aladdin_otp",
  WHATSAPP_OTP_LANGUAGE: "ar",
  WHATSAPP_GRAPH_API_VERSION: "v25.0",
  WHATSAPP_DELIVERY_ENABLED: "false",
  OTP_ALLOWED_RECIPIENTS: "+201012345678",
};
const event = JSON.stringify({ user: { phone: "+201012345678" }, sms: { otp: "123456" } });

/** Fake D1 unique constraint: insert claim synchronously before returning its promise. */
function makeReplayDb(): ReplayDb {
  const saved = new Map<string, string>();
  return {
    prepare(sql: string) {
      return {
        bind(...values: (string | number)[]) {
          return {
            async run() {
              if (sql.startsWith("INSERT OR IGNORE")) {
                const id = String(values[0]);
                if (saved.has(id)) return { success: true, meta: { changes: 0 } };
                saved.set(id, "reserved");
                return { success: true, meta: { changes: 1 } };
              }
              if (sql.startsWith("UPDATE")) {
                const [nextState, idValue] = values;
                const id = String(idValue);
                if (saved.get(id) !== "reserved") return { success: true, meta: { changes: 0 } };
                saved.set(id, String(nextState));
                return { success: true, meta: { changes: 1 } };
              }
              throw new Error("Unexpected SQL");
            },
            async first<T>() {
              const id = String(values[0]);
              return (saved.has(id) ? { state: saved.get(id) } : null) as T | null;
            },
          };
        },
      };
    },
  };
}


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
  const result = await handleRequest(await signedRequest(event, false), { ...env, WHATSAPP_DELIVERY_ENABLED: "true", IDEMPOTENCY_DB: makeReplayDb() }, (async () => {
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
test("does not read Meta account secret while delivery is disabled", async () => {
  let reads = 0;
  const guarded = {
    ...env,
    WHATSAPP_ACCESS_TOKEN: { get: async () => { reads++; return "unexpected"; } },
  };
  const result = await handleRequest(await signedRequest(event), guarded);
  assert.equal(result.status, 503);
  assert.equal(reads, 0);
});
test("signing secret binding outages fail closed", async () => {
  const req=await signedRequest(event);
  let calls=0;
  const r=await handleRequest(req,{...env,SUPABASE_SEND_SMS_HOOK_SECRET:{get:async()=>{throw new Error("offline");}}},(async()=>{calls++;return new Response();}) as typeof fetch);
  assert.equal(r.status,503);
  assert.equal(calls,0);
});
test("missing Secrets Store secret refuses to contact Meta", async () => {
  let calls = 0;
  const guarded = {
    ...env, WHATSAPP_DELIVERY_ENABLED: "true",
    WHATSAPP_ACCESS_TOKEN: { get: async () => "" },
    IDEMPOTENCY_DB: makeReplayDb(),
  };
  const result = await handleRequest(await signedRequest(event), guarded, (async () => {
    calls++; return new Response(JSON.stringify({ messages: [{ id: "wrong" }] }), { status: 200 });
  }) as typeof fetch);
  assert.equal(result.status, 502);
  assert.equal(calls, 0);
});
test("sends copy-code Arabic template once with matching body and button", async () => {
  let calls = 0;
  const result = await handleRequest(await signedRequest(event), { ...env, WHATSAPP_DELIVERY_ENABLED: "true", IDEMPOTENCY_DB: makeReplayDb() }, (async (url, init) => {
    calls++;
    assert.equal(String(url), "https://graph.facebook.com/v25.0/1415528588305492/messages");
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
test("phone_change new_phone recipient is not silently replaced with user.phone", async () => {
  const change={
    user:{phone:"+201012345678"},
    new_phone:"+201112345678",
    sms:{otp:"123456"},
  };
  assert.equal(parseEvent(JSON.stringify(change)),null);
  assert.equal(parseEvent(JSON.stringify({...change,new_phone:undefined,sms:{...change.sms,new_phone:"+201112345678"}})),null);
  assert.equal(parseEvent(JSON.stringify({...change,new_phone:undefined,user:{...change.user,new_phone:"+201112345678"}})),null);
  let sends=0;
  const r=await handleRequest(
    await signedRequest(JSON.stringify(change)),
    {...env,WHATSAPP_DELIVERY_ENABLED:"true",IDEMPOTENCY_DB:makeReplayDb()},
    (async()=>{sends++;return new Response("{}",{status:200})}) as typeof fetch
  );
  assert.equal(r.status,422);
  assert.equal(sends,0);
});
test("identical accepted event returns 200 but sends only once", async () => {
  const replayDb = makeReplayDb();
  const e = { ...env, WHATSAPP_DELIVERY_ENABLED: "true", IDEMPOTENCY_DB: replayDb };
  let sends = 0;
  const mockMeta = (async () => {
    sends++;
    return new Response(JSON.stringify({ messages: [{ id: "wamid.mock" }] }), { status: 200 });
  }) as typeof fetch;
  const first = await handleRequest(await signedRequest(event), e, mockMeta);
  const second = await handleRequest(await signedRequest(event), e, mockMeta);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(sends, 1);
});
test("concurrent signed events with the same webhook-id cannot send twice", async () => {
  const replayDb = makeReplayDb();
  const e = { ...env, WHATSAPP_DELIVERY_ENABLED: "true", IDEMPOTENCY_DB: replayDb };
  let sends = 0;
  const mockMeta = (async () => {
    sends++;
    await Promise.resolve();
    return new Response(JSON.stringify({ messages: [{ id: "wamid.mock" }] }), { status: 200 });
  }) as typeof fetch;
  const pair = await Promise.all([
    handleRequest(await signedRequest(event), e, mockMeta),
    handleRequest(await signedRequest(event), e, mockMeta),
  ]);
  assert.equal(sends, 1);
  assert.ok(pair.some(x => x.status === 200));
  assert.ok(pair.every(x => x.status === 200 || x.status === 503));
});
test("no database or allowed recipient means fail-closed with no Meta calls", async () => {
  let sends = 0;
  const mockMeta = (async () => {
    sends++;
    return new Response(JSON.stringify({ messages: [{ id: "wamid.mock" }] }), { status: 200 });
  }) as typeof fetch;
  const noDb = await handleRequest(await signedRequest(event), { ...env, WHATSAPP_DELIVERY_ENABLED: "true" }, mockMeta);
  const noAllow = await handleRequest(await signedRequest(event), {
    ...env, WHATSAPP_DELIVERY_ENABLED: "true", IDEMPOTENCY_DB: makeReplayDb(), OTP_ALLOWED_RECIPIENTS: "",
  }, mockMeta);
  assert.equal(noDb.status, 503);
  assert.equal(noAllow.status, 403);
  assert.equal(sends, 0);
});
test("failed Meta call is recorded and never automatically retried", async () => {
  const replayDb = makeReplayDb();
  const e = { ...env, WHATSAPP_DELIVERY_ENABLED: "true", IDEMPOTENCY_DB: replayDb };
  let sends = 0;
  const mockMeta = (async () => { sends++; return new Response("{}", { status: 400 }); }) as typeof fetch;
  const first = await handleRequest(await signedRequest(event), e, mockMeta);
  const second = await handleRequest(await signedRequest(event), e, mockMeta);
  assert.equal(first.status, 502);
  assert.equal(second.status, 503);
  assert.equal(sends, 1);
});
test("does not leak Meta errors or OTPs", async () => {
  const r = await handleRequest(await signedRequest(event), { ...env, WHATSAPP_DELIVERY_ENABLED: "true", IDEMPOTENCY_DB: makeReplayDb() }, (async () =>
    new Response(JSON.stringify({ error: { message: "do-not-log" } }), { status: 400 })
  ) as typeof fetch);
  assert.equal(r.status, 502);
  const body = await r.text();
  assert.equal(body.includes("123456"), false);
  assert.equal(body.includes("do-not-log"), false);
});
