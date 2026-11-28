import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { handleRequest } from "../src/index.ts";
import { DELIVERY, SECRET, goodBody, mockMeta, signedSend } from "./support.ts";
import { ACTOR, OTHER_ACTOR, SETTINGS_PATH, USAGE_PATH, adminCall, configure, envFor, seedJournal, setDeliverySwitch, settingsBody, usageBody, withD1 } from "./d1.ts";

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

  test("DEFENCE IN DEPTH: a ceiling change the app server did not mark as authorized is refused by the Worker, whatever the caller believes the old ceiling was", async () => {
    await withD1(async (d1, db) => {
      const env = envFor(d1);
      // initialization is a ceiling change too
      for (const flag of [false, undefined]) {
        const res = await adminCall(env, SETTINGS_PATH, settingsBody({ ceiling_authorized: flag }));
        assert.equal(res.status, 403);
        assert.deepEqual(await json(res), { error: "ceiling_not_authorized" });
      }
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM otp_settings").bind().first<{ n: number }>())?.n, 0);
      await setup(d1, env);
      const raise = (over = {}) => settingsBody({ expected_version: 1, hard_ceiling: 8000, ceiling_confirmation: "8000", reason: "Meta tier verified at 10,000 per day", ...over });
      assert.deepEqual(await json(await adminCall(env, SETTINGS_PATH, raise({ ceiling_authorized: false }))), { error: "ceiling_not_authorized" });
      assert.deepEqual(await json(await adminCall(env, SETTINGS_PATH, raise({ ceiling_authorized: undefined }))), { error: "ceiling_not_authorized" });
      assert.equal((await db.prepare("SELECT hard_ceiling FROM otp_settings WHERE id = 1").bind().first<{ hard_ceiling: number }>())?.hard_ceiling, 5000, "nothing changed");
      // the flag is a boolean, never a truthy string
      assert.equal((await adminCall(env, SETTINGS_PATH, raise({ ceiling_authorized: "true" }))).status, 400);
      // a limit-only change does not need it, and the flag does not let a stale or invalid change through
      assert.equal((await adminCall(env, SETTINGS_PATH, settingsBody({ expected_version: 1, daily_limit: 160, ceiling_confirmation: undefined, ceiling_authorized: false, reason: "Raise the limit for the launch week" }))).status, 200);
      assert.deepEqual(await json(await adminCall(env, SETTINGS_PATH, raise({ expected_version: 1, ceiling_authorized: true }))), { error: "stale_version", current_version: 2 });
      assert.equal((await adminCall(env, SETTINGS_PATH, raise({ expected_version: 2, ceiling_authorized: true }))).status, 200);
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
      await setDeliverySwitch(d1, true);
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

import { ADMIN_BYTES, ADMIN_SECRET, GRANT_SECRET, NOTIFY_SECRET, grantFor } from "./d1.ts";

describe("database-issued grant: a leaked admin signing secret cannot authorize or impersonate (F-1)", () => {
  const counts = async (db: any) => ({
    settings: (await db.prepare("SELECT COUNT(*) AS n FROM otp_settings").bind().first())?.n,
    audit: (await db.prepare("SELECT COUNT(*) AS n FROM otp_settings_audit").bind().first())?.n,
    claims: (await db.prepare("SELECT COUNT(*) AS n FROM otp_admin_requests").bind().first())?.n,
  });
  const refused = async (over: Record<string, unknown>, mutate?: (b: Record<string, any>) => void, envOver: Record<string, unknown> = {}) => {
    let out: { status: number; body: any; counts: any } | undefined;
    await withD1(async (d1, db) => {
      const body = settingsBody(over) as Record<string, any>;
      mutate?.(body);
      const res = await adminCall(envFor(d1, envOver), SETTINGS_PATH, body);
      out = { status: res.status, body: await json(res), counts: await counts(db) };
    });
    return out!;
  };
  const nothing = { settings: 0, audit: 0, claims: 0 };

  test("a request signed with the admin secret but WITHOUT a grant is refused as malformed and writes nothing", async () => {
    const r = await refused({}, (b) => { delete b.grant; delete b.grant_expires; });
    assert.equal(r.status, 400);
    assert.deepEqual(r.counts, nothing);
  });

  test("a grant forged with the wrong key (the admin secret, or any key the Worker does not hold) is refused; the request id is not burned", async () => {
    await withD1(async (d1, db) => {
      const env = envFor(d1);
      const forged = settingsBody();
      Object.assign(forged, grantFor(forged, { bytes: ADMIN_BYTES }));
      const res = await adminCall(env, SETTINGS_PATH, forged);
      assert.equal(res.status, 403);
      assert.deepEqual(await json(res), { error: "grant_invalid" });
      assert.deepEqual(await counts(db), nothing);
      Object.assign(forged, grantFor(forged)); // the same request id, now with the genuine grant, is still usable
      assert.equal((await adminCall(env, SETTINGS_PATH, forged)).status, 200);
    });
  });

  test("a genuine grant cannot be reused for different values, a different actor, a flipped ceiling flag, another reason or another request", async () => {
    const tamper: [string, (b: Record<string, any>) => void][] = [
      ["daily limit", (b) => { b.daily_limit = 151; }],
      ["hard ceiling", (b) => { b.hard_ceiling = 9000; b.ceiling_confirmation = "9000"; }],
      ["warn", (b) => { b.warn_percent = 60; }],
      ["critical", (b) => { b.critical_percent = 95; }],
      ["actor (impersonation)", (b) => { b.actor_id = OTHER_ACTOR; }],
      ["expected version", (b) => { b.expected_version = 1; }],
      ["reason", (b) => { b.reason = "A different reason that was never approved"; }],
      ["request id", (b) => { b.request_id = crypto.randomUUID(); }],
      ["expiry", (b) => { b.grant_expires += 60; }],
    ];
    for (const [name, mutate] of tamper) {
      const r = await refused({}, mutate);
      assert.equal(r.status, 403, name);
      assert.deepEqual(r.counts, nothing, name);
    }
  });

  test("a ceiling change the database did not authorize cannot be turned on by editing the flag", async () => {
    // the database issued the grant for ceiling_authorized=false; the attacker flips the field to true
    const r = await refused({ ceiling_authorized: false }, (b) => { b.ceiling_authorized = true; });
    assert.equal(r.status, 403);
    assert.deepEqual(r.counts, nothing);
  });

  test("an expired grant and a far-future grant are refused", async () => {
    const past = await refused({}, (b) => Object.assign(b, grantFor(b, { expires: Math.floor(Date.now() / 1000) - 5 })));
    assert.equal(past.status, 403);
    const future = await refused({}, (b) => Object.assign(b, grantFor(b, { expires: Math.floor(Date.now() / 1000) + 86_400 })));
    assert.equal(future.status, 403);
    assert.deepEqual(future.counts, nothing);
  });

  test("an unbound, empty or unreadable grant secret fails closed (503) and writes nothing", async () => {
    for (const over of [{ OTP_ADMIN_GRANT_SECRET: undefined }, { OTP_ADMIN_GRANT_SECRET: { get: async () => "" } }, { OTP_ADMIN_GRANT_SECRET: { get: async () => { throw new Error("store down"); } } }]) {
      const r = await refused({}, undefined, over);
      assert.equal(r.status, 503);
      assert.deepEqual(r.body, { error: "grant_unconfigured" });
      assert.deepEqual(r.counts, nothing);
    }
  });

  test("a malformed grant (wrong length, wrong alphabet, wrong type) is refused as invalid", async () => {
    for (const bad of ["", "x", "A".repeat(43), "A".repeat(44), "!".repeat(43) + "=", 5]) {
      const r = await refused({}, (b) => { b.grant = bad; });
      assert.equal(r.status, 400, String(bad));
      assert.deepEqual(r.counts, nothing);
    }
  });

  test("the read-only usage route needs no grant, and a valid grant never replaces the admin signature", async () => {
    await withD1(async (d1) => {
      const env = envFor(d1);
      assert.equal((await adminCall(env, USAGE_PATH, usageBody())).status, 200);
      assert.equal((await adminCall(env, SETTINGS_PATH, settingsBody(), { skipSignature: true })).status, 401);
    });
  });
});

describe("usage carries the non-secret runtime facts (a private Worker cannot be preflighted from outside)", () => {
  test("environment, switches and which bindings exist - never a value", async () => {
    await withD1(async (d1) => {
      await configure(d1);
      const env = envFor(d1, { OTP_ENVIRONMENT: "production", OTP_RECIPIENT_MODE: "open", OTP_ALLOWED_RECIPIENTS: "", WHATSAPP_DELIVERY_ENABLED: "false" });
      const res = await adminCall(env, USAGE_PATH, usageBody());
      const text = await res.text();
      const out = JSON.parse(text);
      assert.equal(res.status, 200);
      assert.deepEqual(
        { e: out.runtime.environment, m: out.runtime.recipient_mode, d: out.runtime.delivery_enabled, a: out.runtime.allowlist_entries, ad: out.runtime.admin_secret_bound, g: out.runtime.admin_grant_secret_bound, n: out.runtime.notify_configured, db: out.runtime.d1_reachable },
        { e: "production", m: "open", d: false, a: 0, ad: true, g: true, n: true, db: true },
      );
      for (const secret of [ADMIN_SECRET, GRANT_SECRET, NOTIFY_SECRET, SECRET]) assert.ok(!text.includes(secret), "no secret value may appear in the answer");
      const missing = await json(await adminCall(envFor(d1, { OTP_ADMIN_GRANT_SECRET: undefined }), USAGE_PATH, usageBody()));
      assert.equal(missing.runtime.admin_grant_secret_bound, false);
    });
  });
});

import { verifySignature as verifyHeaders } from "../src/signing.ts";

describe("notify-check: the Worker proves the app's alert endpoint is reachable (F-5 release gate)", () => {
  const NOTIFY_CHECK = "/v1/admin/notify-check";
  const check = async (answer: (req: Request) => Promise<Response> | Response, envOver: Record<string, unknown> = {}) => {
    const seen: { url: string; headers: Headers; body: string; redirect?: string }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: new Headers(init.headers), body: String(init.body), redirect: init.redirect });
      return answer(new Request(url, init));
    }) as unknown as typeof fetch;
    let result: Record<string, any> = {};
    let status = 0;
    await withD1(async (d1) => {
      const body = usageBody();
      const raw = JSON.stringify(body);
      const id = `adm_${body.request_id}`;
      const stamp = String(Math.floor(Date.now() / 1000));
      const { sign } = await import("./support.ts");
      const headers = { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": stamp, "webhook-signature": await sign(id, stamp, raw, ADMIN_BYTES) };
      const res = await handleRequest(new Request("https://worker.test" + NOTIFY_CHECK, { method: "POST", headers, body: raw }), envFor(d1, { APP_NOTIFY: { fetch: fetcher }, ...envOver } as any), fetcher);
      status = res.status;
      result = await json(res);
    });
    return { status, result, seen };
  };

  test("a 400 from the app (signature accepted, probe body refused) means reachable; the probe is signed, minimal and pinned to the configured URL", async () => {
    const r = await check(() => new Response(null, { status: 400 }));
    assert.equal(r.status, 200);
    assert.deepEqual(r.result, { result: "reachable", status: 400 });
    assert.equal(r.seen.length, 1);
    assert.equal(r.seen[0]!.url, "https://app.test/api/internal/whatsapp-otp/notify");
    assert.equal(r.seen[0]!.body, '{"probe":true}');
    assert.equal(r.seen[0]!.redirect, "manual");
    assert.equal(await verifyHeaders(r.seen[0]!.body, r.seen[0]!.headers, NOTIFY_SECRET), true, "signed with the NOTIFY secret");
    assert.equal(await verifyHeaders(r.seen[0]!.body, r.seen[0]!.headers, ADMIN_SECRET), false, "never the admin secret");
  });

  test("each failure mode is reported as a distinct, value-free category", async () => {
    assert.deepEqual((await check(() => new Response(null, { status: 401 }))).result, { result: "secret_mismatch", status: 401 });
    assert.deepEqual((await check(() => new Response(null, { status: 403 }))).result, { result: "refused", status: 403 });
    assert.deepEqual((await check(() => new Response(null, { status: 403, headers: { "cf-mitigated": "challenge" } }))).result, { result: "blocked_by_cloudflare", status: 403 });
    assert.deepEqual((await check(() => new Response(null, { status: 503 }))).result, { result: "app_unconfigured", status: 503 });
    assert.deepEqual((await check(() => new Response(null, { status: 200 }))).result, { result: "unexpected", status: 200 });
    assert.deepEqual((await check(() => new Response(null, { status: 302, headers: { location: "https://elsewhere.test/" } }))).result, { result: "unexpected", status: 302 });
    assert.deepEqual((await check(() => { throw new Error("network down https://secret-host.example"); })).result, { result: "unreachable" });
  });

  test("an unconfigured Worker reports not_configured and calls nothing", async () => {
    for (const over of [{ OTP_NOTIFY_URL: undefined }, { OTP_NOTIFY_SIGNING_SECRET: undefined }, { OTP_NOTIFY_SIGNING_SECRET: { get: async () => "" } }]) {
      const r = await check(() => new Response(null, { status: 400 }), over);
      assert.deepEqual(r.result, { result: "not_configured" });
      assert.equal(r.seen.length, 0);
    }
  });

  test("it needs the admin signature like every admin route, and is single-use", async () => {
    await withD1(async (d1) => {
      const env = envFor(d1);
      assert.equal((await adminCall(env, NOTIFY_CHECK, usageBody(), { skipSignature: true })).status, 401);
      assert.equal((await adminCall(env, NOTIFY_CHECK, usageBody(), { secretBytes: new Uint8Array(32).fill(90) })).status, 401);
      const body = usageBody();
      assert.equal((await adminCall(env, NOTIFY_CHECK, body)).status, 200);
      assert.equal((await adminCall(env, NOTIFY_CHECK, body)).status, 409);
    });
  });
});
