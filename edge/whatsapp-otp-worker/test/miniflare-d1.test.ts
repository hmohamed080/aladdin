import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { Miniflare } from "miniflare";
import { claimEvent, handleRequest, purgeExpiredReplayClaims, type ReplayDb } from "../src/index.ts";
import { DELIVERY, baseEnv, goodBody, mockMeta, signedSend } from "./support.ts";

const OTHER = "7c2e5d2d-1e4b-4d6f-8b88-3a7e4a1b0c22";

async function freshD1(mf: Miniflare) {
  const d1 = await mf.getD1Database("IDEMPOTENCY_DB");
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const ddl = readFileSync(new URL(file, dir), "utf8").split(/\r?\n/).filter((line) => !line.trim().startsWith("--")).join("\n");
    for (const stmt of ddl.split(";").map((x) => x.trim()).filter(Boolean)) assert.equal((await d1.prepare(stmt).run()).success, true, file);
  }
  return d1;
}

/** Test fixture only: a configured settings row (production never gets one from code or a migration). */
async function configure(d1: Awaited<ReturnType<typeof freshD1>>, dailyLimit: number, hardCeiling = 5000) {
  await d1.prepare("INSERT INTO otp_settings (id, daily_limit, hard_ceiling, warn_percent, critical_percent, version, updated_at, updated_by) VALUES (1, ?1, ?2, 70, 90, 1, 0, '00000000-0000-4000-8000-000000000001')").bind(dailyLimit, hardCeiling).run();
}

test("D1 real SQL engine: the global rolling-24h budget holds under concurrency (one atomic statement), follows a live settings change, never blocks a replay, ignores old claims", async () => {
  const mf = new Miniflare({ modules: true, script: 'export default { async fetch() { return new Response("local"); } };', d1Databases: { IDEMPOTENCY_DB: "otp-budget-d1-only" } });
  try {
    const d1 = await freshD1(mf); const db = d1 as unknown as ReplayDb;
    // No settings row: the very statement inserts nothing (fail closed even without the handler's pre-read).
    assert.equal((await claimEvent(db, "otp_budget-none", true)).outcome, "budget");
    await configure(d1, 3);
    const outcomes = await Promise.all(Array.from({ length: 12 }, (_, i) => claimEvent(db, `otp_budget-${i}`, true)));
    assert.equal(outcomes.filter((o) => o.outcome === "new").length, 3, "exactly the limit is claimed");
    assert.equal(outcomes.filter((o) => o.outcome === "budget").length, 9);
    assert.equal((await d1.prepare("SELECT COUNT(*) AS n FROM whatsapp_hook_events").first<{ n: number }>())?.n, 3);
    // A dashboard change applies to the very next claim, with no redeploy: raise the limit and two more are admitted.
    await d1.prepare("UPDATE otp_settings SET daily_limit = 5, version = version + 1 WHERE id = 1").run();
    const more = await Promise.all(Array.from({ length: 6 }, (_, i) => claimEvent(db, `otp_budget-more-${i}`, true)));
    assert.equal(more.filter((o) => o.outcome === "new").length, 2);
    // Lowering the limit below current consumption refuses everything new until the window moves.
    await d1.prepare("UPDATE otp_settings SET daily_limit = 1, version = version + 1 WHERE id = 1").run();
    assert.equal((await claimEvent(db, "otp_budget-after-lower", true)).outcome, "budget");
    const first = outcomes.find((o) => o.outcome === "new")!;
    await d1.prepare("UPDATE whatsapp_hook_events SET state = 'accepted' WHERE event_hash = ?1").bind(first.idHash).run();
    assert.equal((await claimEvent(db, `otp_budget-${outcomes.indexOf(first)}`, true)).outcome, "accepted", "a replay is a duplicate, not a budget refusal");
    await d1.prepare("UPDATE whatsapp_hook_events SET created_at = ?1").bind(Math.floor(Date.now() / 1000) - 90_000).run();
    assert.equal((await claimEvent(db, "otp_budget-after-window", true)).outcome, "new", "claims older than 24h are outside the window");
  } finally {
    await mf.dispose();
  }
});

test("D1 real SQL engine: one challenge delivers once under concurrency, failures are never retried, replays never re-send", async () => {
  const mf = new Miniflare({ modules: true, script: 'export default { async fetch() { return new Response("local"); } };', d1Databases: { IDEMPOTENCY_DB: "otp-local-d1-only" } });
  try {
    const d1 = await freshD1(mf);
    await configure(d1, 1000);
    await d1.prepare("INSERT INTO otp_delivery_switch (id, enabled, version, updated_at, updated_by) VALUES (1, 1, 1, 0, '00000000-0000-4000-8000-000000000001')").run(); // the Super Admin switch is ON
    await d1.prepare("INSERT INTO otp_delivery_audit (at, request_id, actor, old_enabled, new_enabled, new_version, reason) VALUES (0, '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', NULL, 1, 1, 'fixture: audited switch change')").run(); // ...with the audit row the admin route always writes with it
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
