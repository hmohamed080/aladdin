import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { handleRequest } from "../src/index.ts";
import { DELIVERY, SECRET, goodBody, mockMeta, signedSend } from "./support.ts";
import { ACTOR, OTHER_ACTOR, SETTINGS_PATH, USAGE_PATH, adminCall, configure, envFor, seedJournal, settingsBody, usageBody, withD1 } from "./d1.ts";

const json = async (r: Response) => (await r.json()) as Record<string, any>;
const now = () => Math.floor(Date.now() / 1000);

describe("admin routes: authentication (separate secret, nothing runs without it)", () => {
  test("no signature, a tampered body, a stale timestamp and the OTP SEND secret are all refused; nothing is written", async () => {
    await withD1(async (d1, db) => {
      const env = envFor(d1);
      const body = settingsBody();
      assert.equal((await adminCall(env, SETTINGS_PATH, body, { skipSignature: true })).status, 401);
      // the signature covers the exact bytes: changing one value after signing is refused
      const sent = JSON.stringify(body);
      const tampered = sent.replace('"daily_limit":150', '"daily_limit":151');
      assert.notEqual(sent, tampered);
      const id = `adm_${body.request_id}`;
      const stamp = String(now());
      const { sign } = await import("./support.ts");
      const sig = await sign(id, stamp, sent);
      const res = await handleRequest(new Request("https://worker.test" + SETTINGS_PATH, { method: "POST", headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": stamp, "webhook-signature": sig }, body: tampered }), env);
      assert.equal(res.status, 401);
      assert.equal((await adminCall(env, SETTINGS_PATH, settingsBody(), { offsetSeconds: -400 })).status, 401, "clock window");
      assert.equal((await adminCall(env, SETTINGS_PATH, settingsBody(), { offsetSeconds: 400 })).status, 401, "clock window (future)");
      // the credential that signs OTP SENDS cannot drive an admin route
      assert.equal((await adminCall(env, SETTINGS_PATH, settingsBody(), { secretBytes: new Uint8Array(32).fill(90) })).status, 401);
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM otp_settings").bind().first<{ n: number }>())?.n, 0);
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM otp_settings_audit").bind().first<{ n: number }>())?.n, 0);
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM otp_admin_requests").bind().first<{ n: number }>())?.n, 0, "an unauthenticated request does not even claim an id");
    });
  });

  test("the admin secret cannot send an OTP and the send secret cannot reach the admin routes (credentials stay separate)", async () => {
    await withD1(async (d1) => {
      await configure(d1);
      const env = envFor(d1); const meta = mockMeta();
      const adminSigned = await signedSend(goodBody(), { secretBytes: new Uint8Array(32).fill(77) });
      assert.equal((await handleRequest(adminSigned, env, meta.fetcher)).status, 401);
      assert.equal(meta.calls.length, 0);
      const sendSigned = await signedSend(JSON.stringify(settingsBody()), { path: SETTINGS_PATH, id: `adm_${crypto.randomUUID()}` });
      assert.equal((await handleRequest(sendSigned, env, meta.fetcher)).status, 401);
    });
  });

  test("an unbound or unreadable admin secret fails closed with 503; wrong method, path, content type and oversize bodies are refused", async () => {
    await withD1(async (d1) => {
      assert.equal((await adminCall(envFor(d1, { OTP_ADMIN_SIGNING_SECRET: undefined }), SETTINGS_PATH, settingsBody())).status, 503);
      assert.equal((await adminCall(envFor(d1, { OTP_ADMIN_SIGNING_SECRET: { get: async () => { throw new Error("store down"); } } }), SETTINGS_PATH, settingsBody())).status, 503);
      assert.equal((await adminCall(envFor(d1, { OTP_ADMIN_SIGNING_SECRET: { get: async () => "" } }), SETTINGS_PATH, settingsBody())).status, 503);
      const env = envFor(d1);
      assert.equal((await adminCall(env, SETTINGS_PATH, settingsBody(), { contentType: "text/plain" })).status, 415);
      assert.equal((await handleRequest(new Request("https://worker.test" + SETTINGS_PATH, { method: "GET" }), env)).status, 404);
      assert.equal((await adminCall(env, SETTINGS_PATH, JSON.stringify({ reason: "x".repeat(5000) }))).status, 413);
    });
  });

  test("a captured signed request is applied ONCE: the replay is refused and writes no second audit row", async () => {
    await withD1(async (d1, db) => {
      const env = envFor(d1);
      const body = settingsBody();
      const first = await adminCall(env, SETTINGS_PATH, body);
      assert.equal(first.status, 200);
      const replay = await adminCall(env, SETTINGS_PATH, body);
      assert.equal(replay.status, 409);
      assert.deepEqual(await json(replay), { error: "replay" });
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM otp_settings_audit").bind().first<{ n: number }>())?.n, 1);
      // the same id on a usage request is also single-use
      const u = usageBody();
      assert.equal((await adminCall(env, USAGE_PATH, u)).status, 200);
      assert.equal((await adminCall(env, USAGE_PATH, u)).status, 409);
    });
  });

  test("the signed id must BE the request id (one valid signature cannot be replayed as another request); unknown keys and malformed ids are refused", async () => {
    await withD1(async (d1) => {
      const env = envFor(d1);
      assert.equal((await adminCall(env, SETTINGS_PATH, settingsBody(), { id: `adm_${crypto.randomUUID()}` })).status, 400);
      assert.equal((await adminCall(env, SETTINGS_PATH, settingsBody({ is_admin: true }))).status, 400, "unknown key");
      assert.equal((await adminCall(env, SETTINGS_PATH, settingsBody({ actor_id: "not-a-uuid" }))).status, 400);
      assert.equal((await adminCall(env, SETTINGS_PATH, settingsBody({ request_id: "nope" }), { id: "adm_nope" })).status, 400);
      assert.equal((await adminCall(env, USAGE_PATH, { request_id: crypto.randomUUID(), extra: 1 })).status, 400);
      assert.equal((await adminCall(env, SETTINGS_PATH, "not json", { id: "adm_x" })).status, 400);
    });
  });
});

describe("settings: initialization, updates, compare-and-set and the audit trail", () => {
  test("initialization needs expected_version 0, a typed ceiling confirmation and a reason; it records the actor, the values and the time", async () => {
    await withD1(async (d1, db) => {
      const env = envFor(d1);
      assert.deepEqual(await json(await adminCall(env, SETTINGS_PATH, settingsBody({ expected_version: 3 }))), { error: "stale_version", current_version: 0 });
      assert.deepEqual(await json(await adminCall(env, SETTINGS_PATH, settingsBody({ ceiling_confirmation: undefined }))), { error: "ceiling_confirmation_required" });
      assert.deepEqual(await json(await adminCall(env, SETTINGS_PATH, settingsBody({ ceiling_confirmation: "4999" }))), { error: "ceiling_confirmation_required" });
      assert.deepEqual(await json(await adminCall(env, SETTINGS_PATH, settingsBody({ reason: "too short" }))), { error: "reason_too_short" });
      const res = await adminCall(env, SETTINGS_PATH, settingsBody());
      assert.equal(res.status, 200);
      const out = await json(res);
      assert.equal(out.status, "applied"); assert.equal(out.version, 1); assert.equal(out.old, null);
      assert.deepEqual({ ...out.new, updated_at: 0 }, { daily_limit: 150, hard_ceiling: 5000, warn_percent: 70, critical_percent: 90, version: 1, updated_at: 0, updated_by: ACTOR });
      const audit = await db.prepare("SELECT kind, actor, old_daily_limit, new_daily_limit, new_hard_ceiling, new_version, reason, at FROM otp_settings_audit").bind().first<Record<string, any>>();
      assert.equal(audit?.kind, "initialize"); assert.equal(audit?.actor, ACTOR); assert.equal(audit?.old_daily_limit, null);
      assert.equal(audit?.new_daily_limit, 150); assert.equal(audit?.new_hard_ceiling, 5000); assert.equal(audit?.new_version, 1);
      assert.ok(Math.abs(Number(audit?.at) - now()) < 10);
      // initialization cannot be repeated
      assert.deepEqual(await json(await adminCall(env, SETTINGS_PATH, settingsBody())), { error: "stale_version", current_version: 1 });
    });
  });

  test("an update records the OLD and NEW values in the SAME atomic step; a limit-only change needs no ceiling confirmation; a no-op is refused", async () => {
    await withD1(async (d1, db) => {
      const env = envFor(d1);
      await adminCall(env, SETTINGS_PATH, settingsBody());
      const res = await adminCall(env, SETTINGS_PATH, settingsBody({ expected_version: 1, daily_limit: 200, ceiling_confirmation: undefined, reason: "Raise for the launch week" , actor_id: OTHER_ACTOR }));
      assert.equal(res.status, 200);
      const out = await json(res);
      assert.equal(out.version, 2); assert.equal(out.old.daily_limit, 150); assert.equal(out.new.daily_limit, 200); assert.equal(out.new.updated_by, OTHER_ACTOR);
      const rows = (await db.prepare("SELECT kind, actor, old_daily_limit, new_daily_limit, old_warn_percent, new_warn_percent, new_version FROM otp_settings_audit ORDER BY id").bind().all<Record<string, any>>()).results;
      assert.equal(rows.length, 2);
      assert.deepEqual(rows[1], { kind: "update", actor: OTHER_ACTOR, old_daily_limit: 150, new_daily_limit: 200, old_warn_percent: 70, new_warn_percent: 70, new_version: 2 });
      assert.deepEqual(await json(await adminCall(env, SETTINGS_PATH, settingsBody({ expected_version: 2, daily_limit: 200, ceiling_confirmation: undefined }))), { error: "no_change" });
    });
  });

  test("CONCURRENT changes: of many administrators changing the same version, exactly one wins and the rest get a stale-version refusal (no lost update)", async () => {
    await withD1(async (d1, db) => {
      const env = envFor(d1);
      await adminCall(env, SETTINGS_PATH, settingsBody());
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) => adminCall(env, SETTINGS_PATH, settingsBody({ expected_version: 1, daily_limit: 160 + i, ceiling_confirmation: undefined, reason: `Concurrent change number ${i}` }))));
      const statuses = results.map((r) => r.status).sort();
      assert.equal(statuses.filter((s) => s === 200).length, 1, JSON.stringify(statuses));
      assert.equal(statuses.filter((s) => s === 409).length, 11);
      assert.equal((await db.prepare("SELECT version FROM otp_settings WHERE id = 1").bind().first<{ version: number }>())?.version, 2);
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM otp_settings_audit").bind().first<{ n: number }>())?.n, 2, "init + exactly one winner, never an audit row for a refused change");
    });
  });
});

describe("Hard Ceiling and Daily Send Limit rules", () => {
  const setup = async (d1: any, env: any, limit = 150, ceiling = 5000) => {
    await adminCall(env, SETTINGS_PATH, settingsBody({ daily_limit: limit, hard_ceiling: ceiling, ceiling_confirmation: String(ceiling) }));
  };
  test("the Daily Send Limit can never exceed the Hard Ceiling, in a new request or in the database itself", async () => {
    await withD1(async (d1, db) => {
      const env = envFor(d1);
      assert.deepEqual(await json(await adminCall(env, SETTINGS_PATH, settingsBody({ daily_limit: 6000, hard_ceiling: 5000 }))), { error: "daily_exceeds_ceiling" });
      await setup(d1, env);
      assert.deepEqual(await json(await adminCall(env, SETTINGS_PATH, settingsBody({ expected_version: 1, daily_limit: 5001, ceiling_confirmation: undefined }))), { error: "daily_exceeds_ceiling" });
      // even a direct write that skips every application check is stopped by the CHECK constraint
      await assert.rejects(db.prepare("UPDATE otp_settings SET daily_limit = 9000 WHERE id = 1").bind().run());
      await assert.rejects(db.prepare("UPDATE otp_settings SET hard_ceiling = 100 WHERE id = 1").bind().run(), "ceiling below the stored limit");
      await assert.rejects(db.prepare("UPDATE otp_settings SET hard_ceiling = 1000001 WHERE id = 1").bind().run(), "integer sanity bound");
    });
  });

  test("lowering the ceiling below the CURRENT limit is rejected with a clear code unless the same request atomically lowers the limit too", async () => {
    await withD1(async (d1, db) => {
      const env = envFor(d1);
      await setup(d1, env, 150, 5000);
      const rejected = await adminCall(env, SETTINGS_PATH, settingsBody({ expected_version: 1, daily_limit: 150, hard_ceiling: 100, ceiling_confirmation: "100" }));
      assert.equal(rejected.status, 422);
      assert.deepEqual(await json(rejected), { error: "ceiling_below_current_limit" });
      assert.equal((await db.prepare("SELECT hard_ceiling FROM otp_settings WHERE id = 1").bind().first<{ hard_ceiling: number }>())?.hard_ceiling, 5000, "nothing changed");
      const both = await adminCall(env, SETTINGS_PATH, settingsBody({ expected_version: 1, daily_limit: 80, hard_ceiling: 100, ceiling_confirmation: "100", reason: "Tighten both limits together for the audit" }));
      assert.equal(both.status, 200);
      const row = await db.prepare("SELECT daily_limit, hard_ceiling FROM otp_settings WHERE id = 1").bind().first<Record<string, number>>();
      assert.deepEqual(row, { daily_limit: 80, hard_ceiling: 100 });
    });
  });

  test("changing the ceiling is sensitive: it needs the typed confirmation of the new number AND a longer reason; raising it is not free", async () => {
    await withD1(async (d1) => {
      const env = envFor(d1);
      await setup(d1, env);
      const raise = (over = {}) => settingsBody({ expected_version: 1, hard_ceiling: 8000, ...over });
      assert.deepEqual(await json(await adminCall(env, SETTINGS_PATH, raise({ ceiling_confirmation: undefined }))), { error: "ceiling_confirmation_required" });
      assert.deepEqual(await json(await adminCall(env, SETTINGS_PATH, raise({ ceiling_confirmation: "5000" }))), { error: "ceiling_confirmation_required" });
      assert.deepEqual(await json(await adminCall(env, SETTINGS_PATH, raise({ ceiling_confirmation: "8000", reason: "ok ok ok ok" }))), { error: "reason_too_short" });
      const ok = await adminCall(env, SETTINGS_PATH, raise({ ceiling_confirmation: "8000", reason: "Meta tier verified at 10,000 per day" }));
      assert.equal(ok.status, 200);
      assert.equal((await json(ok)).new.hard_ceiling, 8000);
    });
  });

  test("invalid values are refused at every layer: non-integers, out-of-range, threshold order, wrong types", async () => {
    await withD1(async (d1) => {
      const env = envFor(d1);
      const cases: Array<[Record<string, unknown>, number, string?]> = [
        [{ daily_limit: 0 }, 422, "invalid_values"], [{ daily_limit: -5 }, 422, "invalid_values"], [{ hard_ceiling: 1_000_001, daily_limit: 150, ceiling_confirmation: "1000001" }, 422, "invalid_values"],
        [{ warn_percent: 90, critical_percent: 70 }, 422, "thresholds_out_of_order"], [{ warn_percent: 70, critical_percent: 70 }, 422, "thresholds_out_of_order"],
        [{ warn_percent: 0 }, 422, "thresholds_out_of_order"], [{ critical_percent: 101 }, 422, "thresholds_out_of_order"],
        [{ daily_limit: 2.5 }, 400], [{ daily_limit: "150" }, 400], [{ daily_limit: null }, 400], [{ daily_limit: Number.MAX_SAFE_INTEGER + 2 }, 400],
        [{ reason: 123 }, 400], [{ reason: "bad\u0000reason is long enough" }, 400], [{ expected_version: -1 }, 400], [{ expected_version: 1.5 }, 400],
      ];
      for (const [over, status, error] of cases) {
        const res = await adminCall(env, SETTINGS_PATH, settingsBody(over));
        assert.equal(res.status, status, JSON.stringify(over));
        if (error) assert.deepEqual(await json(res), { error }, JSON.stringify(over));
      }
    });
  });
});

describe("the settings take effect immediately, with no redeploy, and never weaken enforcement", () => {
  test("a dashboard change applies to the very next send; delivery stays an independent switch", async () => {
    await withD1(async (d1) => {
      const env = envFor(d1); const meta = mockMeta();
      const send = async (n: number) => (await handleRequest(await signedSend(goodBody({ delivery_id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` })), env, meta.fetcher)).status;
      assert.equal(await send(1), 503, "no settings row: nothing is sent");
      await adminCall(env, SETTINGS_PATH, settingsBody({ daily_limit: 2 }));
      assert.equal(await send(2), 200); assert.equal(await send(3), 200);
      assert.equal(await send(4), 503, "the limit is enforced");
      await adminCall(env, SETTINGS_PATH, settingsBody({ expected_version: 1, daily_limit: 3, ceiling_confirmation: undefined, reason: "Allow one more send today" }));
      assert.equal(await send(5), 200, "raised without any deploy");
      assert.equal(await send(6), 503);
      await adminCall(env, SETTINGS_PATH, settingsBody({ expected_version: 2, daily_limit: 1, ceiling_confirmation: undefined, reason: "Cut the limit below consumption" }));
      assert.equal(await send(7), 503, "lowering below current usage refuses new sends");
      assert.equal(meta.calls.length, 3);
      const off = await handleRequest(await signedSend(), envFor(d1, { WHATSAPP_DELIVERY_ENABLED: "false" }), meta.fetcher);
      assert.deepEqual(await json(off), { error: "delivery_disabled" });
    });
  });
});

describe("usage report", () => {
  test("counts accepted, failed, reserved, consumed and remaining; computes level and failure rates; lists the change history", async () => {
    await withD1(async (d1) => {
      const env = envFor(d1);
      await adminCall(env, SETTINGS_PATH, settingsBody({ daily_limit: 100 }));
      const t = now();
      await seedJournal(d1, 60, "accepted", t - 600); await seedJournal(d1, 12, "failed", t - 600); await seedJournal(d1, 3, "reserved", t - 30);
      await seedJournal(d1, 10, "accepted", t - 3 * 86_400); await seedJournal(d1, 5, "failed", t - 3 * 86_400);
      const out = await json(await adminCall(env, USAGE_PATH, usageBody()));
      assert.equal(out.configured, true);
      assert.deepEqual({ consumed: out.consumed, accepted: out.accepted, failed: out.failed, reserved: out.reserved, remaining: out.remaining, percent: out.percent, level: out.level }, { consumed: 75, accepted: 60, failed: 12, reserved: 3, remaining: 25, percent: 75, level: "warning" });
      assert.deepEqual(out.failure.last_hour, { attempts: 75, accepted: 60, failed: 12, failure_percent: 17 });
      assert.equal(out.failure.last_7d.attempts, 90); assert.equal(out.failure.last_7d.failed, 17);
      assert.ok(out.failure.last_failure_at >= t - 600 - 2);
      assert.equal(out.audit.length, 1); assert.equal(out.audit[0].actor, ACTOR); assert.equal(out.audit[0].old, null);
      assert.equal(out.settings.version, 1);
    });
  });

  test("an unconfigured Worker reports it plainly instead of inventing a limit", async () => {
    await withD1(async (d1) => {
      const out = await json(await adminCall(envFor(d1), USAGE_PATH, usageBody()));
      assert.equal(out.configured, false); assert.equal(out.settings, null); assert.equal(out.remaining, 0); assert.equal(out.effective_limit, 0);
    });
  });
});
