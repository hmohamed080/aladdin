import { test } from "node:test";
import { strict as assert } from "node:assert";
// @ts-expect-error plain .mjs script
import { run } from "../scripts/worker-preflight.mjs";
import { handleRequest } from "../src/index.ts";
import { FAKE_TOKEN, PHONE, SECRET, baseEnv, mockMeta } from "./support.ts";

const through = (env: ReturnType<typeof baseEnv>, meta = mockMeta()) =>
  (async (url: string, init: RequestInit) => handleRequest(new Request(url, init), env, meta.fetcher)) as unknown as typeof fetch;

test("the script's real signer is accepted by the Worker and reports a healthy, delivery-OFF Acceptance Worker", async () => {
  const meta = mockMeta(); const out: string[] = [];
  const code = await run("https://worker.example.invalid", { PHONE_OTP_WORKER_SECRET: SECRET }, through(baseEnv({ WHATSAPP_DELIVERY_ENABLED: "false" }), meta), (l: string) => out.push(l));
  assert.equal(code, 0);
  const r = JSON.parse(out.join("")); assert.equal(r.ok, true); assert.equal(r.delivery_enabled, false); assert.equal(r.environment, "acceptance"); assert.equal(r.allowlist_entries, 1);
  assert.equal(meta.calls.length, 0, "preflight never calls Meta");
  for (const s of [FAKE_TOKEN, SECRET, PHONE, "1012345678"]) assert.ok(!out.join("").includes(s));
});
test("it fails (exit 1) with a clear hint for a wrong secret, a missing token binding, no D1, or an empty allowlist", async () => {
  const wrong = []; assert.equal(await run("https://w.example.invalid", { PHONE_OTP_WORKER_SECRET: "whsec_" + btoa("x".repeat(32)) }, through(baseEnv()), (l: string) => wrong.push(l)), 1);
  assert.match(wrong.join(""), /signing secret differs/);
  for (const over of [{ WHATSAPP_ACCESS_TOKEN: { get: async () => "" } }, { IDEMPOTENCY_DB: undefined }, { OTP_ALLOWED_RECIPIENTS: "" }] as Array<Partial<ReturnType<typeof baseEnv>>>)
    assert.equal(await run("https://w.example.invalid", { PHONE_OTP_WORKER_SECRET: SECRET }, through(baseEnv(over)), () => {}), 1, JSON.stringify(Object.keys(over)));
});
test("missing input or an insecure URL calls nothing", async () => {
  let n = 0; const f = (async () => { n++; return new Response("{}"); }) as unknown as typeof fetch;
  assert.equal(await run(undefined, {}, f, () => {}), 3);
  assert.equal(await run("http://worker.example.invalid", { PHONE_OTP_WORKER_SECRET: SECRET }, f, () => {}), 2);
  assert.equal(await run("https://w.example.invalid", { PHONE_OTP_WORKER_SECRET: "nope" }, f, () => {}), 2);
  assert.equal(n, 0);
});
