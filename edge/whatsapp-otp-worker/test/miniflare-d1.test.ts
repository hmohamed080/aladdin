import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { claimEvent, handleRequest, type ReplayDb } from "../src/index.ts";

const signingSecret = "v1,whsec_" + btoa("Z".repeat(32));
const fixture = JSON.stringify({user:{phone:"+201012345678"},sms:{otp:"123456"}});
const clock = () => Math.floor(Date.now()/1000);

async function signedRequest(id: string) {
  const ts = String(clock());
  const key = await crypto.subtle.importKey(
    "raw", Uint8Array.from(atob(signingSecret.slice(9)), x=>x.charCodeAt(0)),
    {name:"HMAC",hash:"SHA-256"}, false, ["sign"]
  );
  const signed = new TextEncoder().encode(id+"."+ts+"."+fixture);
  const mac = await crypto.subtle.sign("HMAC", key, signed);
  const signature = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return new Request("https://worker.test/hooks/supabase/send-sms",{
    method:"POST",headers:{
      "content-type":"application/json",
      "webhook-id":id,"webhook-timestamp":ts,"webhook-signature":"v1,"+signature,
    },body:fixture,
  });
}

function baseEnv(db: ReplayDb) {
  return {
    SUPABASE_SEND_SMS_HOOK_SECRET:signingSecret,
    WHATSAPP_ACCESS_TOKEN:{get:async () => "local-fake-token-not-a-credential"},
    WHATSAPP_PHONE_NUMBER_ID:"1415528588305492",
    WHATSAPP_OTP_TEMPLATE:"aladdin_otp",
    WHATSAPP_OTP_LANGUAGE:"ar",
    WHATSAPP_GRAPH_API_VERSION:"v25.0",
    WHATSAPP_DELIVERY_ENABLED:"true",
    OTP_ALLOWED_RECIPIENTS:"+201012345678",
    IDEMPOTENCY_DB: db,
  };
}
function mockMeta(onCall:()=>void, success=true): typeof fetch {
  return (async () => {
    onCall();
    return success
      ? new Response(JSON.stringify({messages:[{id:"wamid.local-only"}]}),{status:200})
      : new Response("{}",{status:502});
  }) as typeof fetch;
}

test("D1 real SQL engine: concurrent signed Worker handlers atomically claim once",async()=>{
  const mf = new Miniflare({
    modules: true,
    script: 'export default { async fetch() { return new Response("local"); } };',
    d1Databases:{ IDEMPOTENCY_DB:"otp-local-d1-only" },
  });
  try{
    const d1 = await mf.getD1Database("IDEMPOTENCY_DB");
    // D1.exec splits by newline; SQL comment-only lines are not valid executable statements.
    // Keep the exact migration SQL statements, removing just standalone comment lines.
    const ddl = readFileSync(new URL("../migrations/0001_hook_events.sql",import.meta.url),"utf8")
      .split(/\r?\n/).filter(line => !line.trim().startsWith("--")).join("\n");
    // D1.exec treats each newline as a standalone statement; migration SQL is multiline.
    // Prepare each semicolon-delimited statement instead, matching remote migration execution.
    for (const stmt of ddl.split(";").map(x => x.trim()).filter(Boolean)) {
      const result = await d1.prepare(stmt).run();
      assert.equal(result.success, true);
    }
    const db=d1 as unknown as ReplayDb;
    const first = await claimEvent(db,"d1-direct-smoke-1");
    const repeat = await claimEvent(db,"d1-direct-smoke-1");
    assert.equal(first.outcome,"new");
    assert.equal(repeat.outcome,"blocked");

    let metaCalls=0;
    const mock=mockMeta(()=>metaCalls++);
    const env=baseEnv(db);
    const [a,b]=await Promise.all([
      handleRequest(await signedRequest("d1-parallel-signed-01"),env,mock),
      handleRequest(await signedRequest("d1-parallel-signed-01"),env,mock),
    ]);
    assert.equal(metaCalls,1);
    assert.ok([a.status,b.status].includes(200));
    assert.ok([a.status,b.status].every(status=>status===200||status===503));

    const replay=await handleRequest(await signedRequest("d1-parallel-signed-01"),env,mock);
    assert.equal(replay.status,200);
    assert.equal(metaCalls,1);

    const row=await d1.prepare("SELECT state FROM whatsapp_hook_events WHERE event_hash = ?1")
      .bind((await d1.prepare("SELECT event_hash FROM whatsapp_hook_events WHERE state='accepted' LIMIT 1").first<{event_hash:string}>())?.event_hash).first<{state:string}>();
    assert.equal(row?.state,"accepted");

    const failEnv=baseEnv(db);
    let failures=0;
    const failedMock=mockMeta(()=>failures++,false);
    const failed=await handleRequest(await signedRequest("d1-meta-failure-01"),failEnv,failedMock);
    const failedReplay=await handleRequest(await signedRequest("d1-meta-failure-01"),failEnv,failedMock);
    assert.equal(failed.status,502);
    assert.equal(failedReplay.status,503);
    assert.equal(failures,1);

    // Missing auth must not attempt delivery or create another replay claim.
    const invalid=await handleRequest(new Request("https://worker.test/hooks/supabase/send-sms",{
      method:"POST",headers:{"content-type":"application/json"},body:fixture
    }),env,mock);
    assert.equal(invalid.status,401);
    assert.equal(metaCalls,1);

    const rows=await d1.prepare("SELECT COUNT(*) AS n FROM whatsapp_hook_events").first<{n:number}>();
    assert.equal(rows?.n,3);
  } finally {
    await mf.dispose();
  }
});

test("built Worker runs through Miniflare HTTP with real D1, delivery OFF", async () => {
  // The source is compiled by the preceding Wrangler dry-run step; never deployed.
  const bundled = process.env.OTP_WORKER_BUNDLE_DIR ?? "/tmp/otp-worker-bundle";
  const files = readdirSync(bundled).filter(name => name.endsWith(".js"));
  assert.equal(files.length, 1, "expected one bundled Worker JS entrypoint");
  const mf = new Miniflare({
    modules: [{ type: "ESModule", path: join(bundled, files[0]) }],
    compatibilityDate: "2026-10-01",
    d1Databases: { IDEMPOTENCY_DB: "otp-http-workerd-test" },
    bindings: {
      SUPABASE_SEND_SMS_HOOK_SECRET: signingSecret,
      WHATSAPP_PHONE_NUMBER_ID: "1415528588305492",
      WHATSAPP_OTP_TEMPLATE: "aladdin_otp",
      WHATSAPP_OTP_LANGUAGE: "ar",
      WHATSAPP_GRAPH_API_VERSION: "v25.0",
      WHATSAPP_DELIVERY_ENABLED: "false",
      OTP_ALLOWED_RECIPIENTS: "",
    },
  });
  try {
    const db = await mf.getD1Database("IDEMPOTENCY_DB");
    const ddl = readFileSync(new URL("../migrations/0001_hook_events.sql",import.meta.url),"utf8")
      .split(String.fromCharCode(10)).filter(line => !line.trim().startsWith("--")).join(" ");
    for (const stmt of ddl.split(";").map(x=>x.trim()).filter(Boolean)) {
      assert.equal((await db.prepare(stmt).run()).success, true);
    }
    assert.equal((await mf.dispatchFetch("https://worker.test/hooks/supabase/send-sms")).status,404);
    assert.equal((await mf.dispatchFetch("https://worker.test/hooks/supabase/send-sms",{
      method:"POST",headers:{"content-type":"text/plain"},body:"x",
    })).status,415);
    assert.equal((await mf.dispatchFetch("https://worker.test/hooks/supabase/send-sms",{
      method:"POST",headers:{"content-type":"application/json"},body:fixture,
    })).status,401);
    const signed=await signedRequest("workerd-signed-disabled-01");
    const disabled=await mf.dispatchFetch("https://worker.test/hooks/supabase/send-sms",{
      method:"POST",headers:Object.fromEntries(signed.headers.entries()),body:fixture,
    });
    assert.equal(disabled.status,503);
    assert.deepEqual(await disabled.json(),{error:"delivery_disabled"});
    const rows=await db.prepare("SELECT COUNT(*) AS n FROM whatsapp_hook_events").first<{n:number}>();
    assert.equal(rows?.n,0, "disabled requests must never claim D1 events");
  } finally {
    await mf.dispose();
  }
});
