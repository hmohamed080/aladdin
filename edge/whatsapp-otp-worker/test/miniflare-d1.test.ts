import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { claimEvent, handleRequest, purgeExpiredReplayClaims, type ReplayDb } from "../src/index.ts";
import { DELIVERY, baseEnv, goodBody, mockMeta, signedSend } from "./support.ts";

const OTHER = "7c2e5d2d-1e4b-4d6f-8b88-3a7e4a1b0c22";

async function freshD1(mf: Miniflare) {
  const d1 = await mf.getD1Database("IDEMPOTENCY_DB");
  const ddl = readFileSync(new URL("../migrations/0001_hook_events.sql", import.meta.url), "utf8")
    .split(/\r?\n/).filter((line) => !line.trim().startsWith("--")).join("\n");
  for (const stmt of ddl.split(";").map((x) => x.trim()).filter(Boolean)) assert.equal((await d1.prepare(stmt).run()).success, true);
  return d1;
}

test("D1 real SQL engine: one challenge delivers once under concurrency, failures are never retried, replays never re-send", async () => {
  const mf = new Miniflare({ modules: true, script: 'export default { async fetch() { return new Response("local"); } };', d1Databases: { IDEMPOTENCY_DB: "otp-local-d1-only" } });
  try {
    const d1 = await freshD1(mf);
    const db = d1 as unknown as ReplayDb;
    assert.equal((await claimEvent(db, `otp_${DELIVERY}`)).outcome, "new");
    assert.equal((await claimEvent(db, `otp_${DELIVERY}`)).outcome, "blocked");

    // concurrent identical signed deliveries, a fresh challenge
    const meta = mockMeta(); const env = baseEnv({ IDEMPOTENCY_DB: db });
    const body = goodBody({ delivery_id: OTHER });
    const results = await Promise.all(Array.from({ length: 8 }, async () => handleRequest(await signedSend(body), env, meta.fetcher)));
    assert.equal(meta.calls.length, 1, "exactly one Meta call for one challenge");
    assert.ok(results.some((r) => r.status === 200));
    assert.ok(results.every((r) => [200, 409, 503].includes(r.status)));
    const replay = await handleRequest(await signedSend(body), env, meta.fetcher);
    assert.equal(replay.status, 200);
    assert.equal(meta.calls.length, 1);

    // a failed delivery: recorded as failed, the replay is refused and Meta is not called again
    const bad = mockMeta(false); const failId = "9d8f6c52-4a41-4e0d-b0a5-1c2f6a3b7e10";
    assert.equal((await handleRequest(await signedSend(goodBody({ delivery_id: failId })), env, bad.fetcher)).status, 502);
    assert.equal((await handleRequest(await signedSend(goodBody({ delivery_id: failId })), env, bad.fetcher)).status, 409);
    assert.equal(bad.calls.length, 1);

    // an unauthenticated request neither calls Meta nor writes a claim
    const before = await d1.prepare("SELECT COUNT(*) AS n FROM whatsapp_hook_events").first<{ n: number }>();
    const unsigned = await handleRequest(new Request("https://worker.test/v1/otp/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), env, meta.fetcher);
    assert.equal(unsigned.status, 401);
    const after = await d1.prepare("SELECT COUNT(*) AS n FROM whatsapp_hook_events").first<{ n: number }>();
    assert.equal(after?.n, before?.n);

    // only hashes and states are stored
    const rows = await d1.prepare("SELECT event_hash, state FROM whatsapp_hook_events").all<{ event_hash: string; state: string }>();
    for (const r of rows.results) { assert.match(r.event_hash, /^[0-9a-f]{64}$/); assert.ok(["reserved", "accepted", "failed"].includes(r.state)); }

    // retention purge removes only old rows
    const old = Math.floor(Date.now() / 1000) - 8 * 86400;
    await d1.prepare("INSERT INTO whatsapp_hook_events (event_hash, created_at, state) VALUES (?1, ?2, 'accepted')").bind("a".repeat(64), old).run();
    const purged = await purgeExpiredReplayClaims(db);
    assert.deepEqual([purged.success, purged.deleted], [true, 1]);
  } finally {
    await mf.dispose();
  }
});
