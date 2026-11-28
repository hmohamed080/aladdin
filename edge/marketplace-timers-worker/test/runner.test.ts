import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import worker from "../src/index.ts";
import { ConfigError, type FetchLike, clampLimit, requireConfig, restBase, runTick } from "../src/runner.ts";

const KEY = "service-role-key-for-tests-0000";
const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: KEY };

interface Call { url: string; headers: Record<string, string>; body: unknown }
function fakeFetch(responses: Array<{ ok?: boolean; status?: number; json?: unknown; throws?: boolean; badJson?: boolean }>) {
  const calls: Call[] = [];
  const fetcher: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const r = responses[calls.length - 1] ?? { ok: true, status: 200, json: {} };
    if (r.throws) throw new Error(`network down ${KEY}`);
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => { if (r.badJson) throw new Error("bad"); return r.json; } };
  };
  return { fetcher, calls };
}

test("a tick calls the two bounded service-role RPCs, timers first, with the key only as headers", async () => {
  const { fetcher, calls } = fakeFetch([
    { json: { processed: 3, reminders: 2, cancelled: 1, errors: 0 } },
    { json: 4 },
  ]);
  const logs: string[] = [];
  const summary = await runTick(env, fetcher, (l) => logs.push(l));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://project.supabase.co/rest/v1/rpc/marketplace_timers_run");
  assert.deepEqual(calls[0].body, { p_limit: 200 });
  assert.equal(calls[1].url, "https://project.supabase.co/rest/v1/rpc/marketplace_checkout_sessions_purge");
  assert.deepEqual(calls[1].body, { p_limit: 200 });
  assert.equal(calls[0].headers.apikey, KEY);
  assert.equal(calls[0].headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(summary.timers.counts, { processed: 3, reminders: 2, cancelled: 1, errors: 0 });
  assert.equal(summary.purge.purged, 4);
  assert.deepEqual(logs, ["marketplace-timers ok processed=3 reminders=2 cancelled=1 errors=0", "marketplace-sessions-purge ok purged=4"]);
});

test("logs carry numbers only: never the key, the url, ids or server text", async () => {
  const { fetcher } = fakeFetch([{ ok: false, status: 500, json: { message: "boom order 123 secret" } }, { throws: true }]);
  const logs: string[] = [];
  await runTick(env, fetcher, (l) => logs.push(l));
  const text = logs.join("\n");
  assert.ok(!text.includes(KEY));
  assert.ok(!text.includes("supabase.co"));
  assert.ok(!text.includes("boom"));
  assert.match(logs[0], /^marketplace-timers failed status=500$/);
  assert.match(logs[1], /^marketplace-sessions-purge failed status=0$/);
});

test("a failed timers call does not block the purge, and a failed purge does not hide the timers result", async () => {
  const a = await runTick(env, fakeFetch([{ ok: false, status: 502 }, { json: 2 }]).fetcher);
  assert.equal(a.timers.ok, false);
  assert.equal(a.purge.ok, true);
  const b = await runTick(env, fakeFetch([{ json: { processed: 1, reminders: 0, cancelled: 0, errors: 0 } }, { ok: false, status: 503 }]).fetcher);
  assert.equal(b.timers.ok, true);
  assert.equal(b.purge.ok, false);
});

test("a malformed answer is a failure, never trusted", async () => {
  const a = await runTick(env, fakeFetch([{ json: { processed: "many" } }, { json: "x" }]).fetcher);
  assert.equal(a.timers.ok, false);
  assert.equal(a.purge.ok, false);
  const b = await runTick(env, fakeFetch([{ badJson: true }, { json: [1] }]).fetcher);
  assert.equal(b.timers.ok, false);
  assert.equal(b.purge.ok, false);
});

test("nothing is retried inside a tick", async () => {
  const { fetcher, calls } = fakeFetch([{ ok: false, status: 500 }, { ok: false, status: 500 }]);
  await runTick(env, fetcher);
  assert.equal(calls.length, 2);
});

test("limits are clamped to the range the database accepts", () => {
  assert.equal(clampLimit(undefined, 200), 200);
  assert.equal(clampLimit("", 200), 200);
  assert.equal(clampLimit("abc", 200), 200);
  assert.equal(clampLimit("12.5", 200), 200);
  assert.equal(clampLimit("0", 200), 1);
  assert.equal(clampLimit("-5", 200), 1);
  assert.equal(clampLimit("100000", 200), 500);
  assert.equal(clampLimit("50", 200), 50);
});

test("configured limits reach the RPC bodies", async () => {
  const { fetcher, calls } = fakeFetch([{ json: { processed: 0, reminders: 0, cancelled: 0, errors: 0 } }, { json: 0 }]);
  await runTick({ ...env, TIMERS_BATCH_LIMIT: "25", SESSIONS_PURGE_LIMIT: "9999" }, fetcher);
  assert.deepEqual(calls[0].body, { p_limit: 25 });
  assert.deepEqual(calls[1].body, { p_limit: 500 });
});

test("config errors stop the tick before any request", async () => {
  for (const bad of [
    {},
    { SUPABASE_URL: "https://x.supabase.co" },
    { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "   " },
    { SUPABASE_URL: "http://evil.example.com", SUPABASE_SERVICE_ROLE_KEY: KEY },
    { SUPABASE_URL: "not a url", SUPABASE_SERVICE_ROLE_KEY: KEY },
  ]) {
    const { fetcher, calls } = fakeFetch([]);
    await assert.rejects(runTick(bad, fetcher), ConfigError);
    assert.equal(calls.length, 0);
  }
  assert.throws(() => requireConfig({}), ConfigError);
});

test("plain http is accepted for a local stack only", () => {
  assert.equal(restBase("http://127.0.0.1:59421"), "http://127.0.0.1:59421/rest/v1/rpc");
  assert.equal(restBase("http://localhost:54321/"), "http://localhost:54321/rest/v1/rpc");
  assert.throws(() => restBase("http://project.supabase.co"), ConfigError);
});

test("the Worker answers no HTTP request and fails loudly when the timers call fails", async () => {
  const res = await worker.fetch();
  assert.equal(res.status, 404);
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
  try {
    await assert.rejects(worker.scheduled({}, env), /marketplace timers run failed/);
  } finally {
    globalThis.fetch = original;
  }
});

test("the checked-in wrangler config is private, scheduled, and holds no secret or hosted binding", () => {
  const raw = readFileSync(fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)), "utf8");
  const config = JSON.parse(raw);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, []);
  assert.deepEqual(config.triggers.crons, ["*/5 * * * *"]);
  assert.ok(!("secrets_store_secrets" in config) && !("d1_databases" in config) && !("services" in config));
  assert.ok(!("SUPABASE_URL" in config.vars) && !("SUPABASE_SERVICE_ROLE_KEY" in config.vars));
  assert.ok(!/eyJ|sb_secret|service_role_key"\s*:/i.test(raw));
});
