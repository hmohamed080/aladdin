import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import worker, { handleRequest, purgeExpiredReplayClaims, type ReplayDb } from "../src/index.ts";
import { deliverOutbox, evaluateAlerts, nextLevel, runMaintenance } from "../src/maintenance.ts";
import { verifySignature } from "../src/signing.ts";
import { goodBody, mockMeta, signedSend } from "./support.ts";
import { ADMIN_SECRET, NOTIFY_SECRET, NOTIFY_URL, configure, envFor, seedJournal, setDeliverySwitch, withD1 } from "./d1.ts";

const now = () => Math.floor(Date.now() / 1000);
const purge = (db: any, n: number) => purgeExpiredReplayClaims(db as unknown as ReplayDb, n);
const outbox = async (db: any) => (await db.prepare("SELECT event_key, kind, payload, delivered_at, attempts, next_attempt_at, last_status FROM otp_notification_outbox ORDER BY rowid").bind().all()).results as Array<Record<string, any>>;
const ageAll = (d1: any, to: number) => d1.prepare("UPDATE whatsapp_hook_events SET created_at = ?1").bind(to).run();

describe("budget alerts: one event per crossing, correct episodes, hysteresis", () => {
  test("warning, critical and exhausted each raise exactly ONE event; running again raises nothing; the payload is statistics only", async () => {
    await withD1(async (d1, db) => {
      await configure(d1, 100, 5000, 70, 90);
      const t = now();
      await seedJournal(d1, 69, "accepted", t - 100);
      assert.deepEqual((await evaluateAlerts(db, t)).raised, [], "69 % is below the warning threshold");
      await seedJournal(d1, 1, "accepted", t - 99, "w");
      assert.deepEqual((await evaluateAlerts(db, t)).raised, ["budget_warning"]);
      assert.deepEqual((await evaluateAlerts(db, t)).raised, [], "the same level raises nothing again");
      await seedJournal(d1, 20, "accepted", t - 98, "c");
      assert.deepEqual((await evaluateAlerts(db, t)).raised, ["budget_critical"]);
      assert.deepEqual((await evaluateAlerts(db, t)).raised, []);
      await seedJournal(d1, 10, "accepted", t - 97, "e");
      assert.deepEqual((await evaluateAlerts(db, t)).raised, ["budget_exhausted"]);
      const rows = await outbox(db);
      assert.deepEqual(rows.map((r) => r.event_key), ["budget_warning:1", "budget_critical:2", "budget_exhausted:3"]);
      const p = JSON.parse(rows[2]!.payload);
      assert.deepEqual(Object.keys(p).sort(), ["accepted", "ceiling", "consumed", "critical_percent", "failed", "level", "limit", "percent", "remaining", "reserved", "warn_percent"]);
      assert.equal(p.remaining, 0); assert.equal(p.level, "exhausted");
      for (const [k, v] of Object.entries(p)) assert.ok(typeof v === "number" || k === "level", `only numbers (and the level name) in the payload: ${k}`);
      assert.ok(!/\+20|whsec_|code|token|secret/i.test(rows[2]!.payload));
    });
  });

  test("a jump from OK straight to critical raises one critical event (not a burst of three)", async () => {
    await withD1(async (d1, db) => {
      await configure(d1, 100);
      await seedJournal(d1, 91, "accepted", now() - 50);
      assert.deepEqual((await evaluateAlerts(db, now())).raised, ["budget_critical"]);
      assert.equal((await outbox(db)).length, 1);
    });
  });

  test("RE-ARM: usage falls back (past the hysteresis margin) then crosses again, so a NEW event is raised; hovering near a threshold never flaps", async () => {
    await withD1(async (d1, db) => {
      await configure(d1, 100, 5000, 70, 90);
      const t = now();
      await seedJournal(d1, 72, "accepted", t - 10);
      assert.deepEqual((await evaluateAlerts(db, t)).raised, ["budget_warning"]);
      // the rolling window drops usage to 67 % (inside the 5-point hysteresis band): still armed as "warning", no new event
      await d1.prepare("UPDATE whatsapp_hook_events SET created_at = ?1 WHERE rowid <= 5").bind(t - 90_000).run();
      assert.deepEqual((await evaluateAlerts(db, t)).raised, []);
      // back to 72 % while still armed: NO duplicate
      await seedJournal(d1, 5, "accepted", t - 9, "h");
      assert.deepEqual((await evaluateAlerts(db, t)).raised, []);
      // usage falls well below the threshold (60 %): the alert re-arms silently
      await d1.prepare("UPDATE whatsapp_hook_events SET created_at = ?1 WHERE rowid <= 17").bind(t - 90_000).run();
      assert.deepEqual((await evaluateAlerts(db, t)).raised, []);
      assert.equal((await db.prepare("SELECT budget_level FROM otp_alert_state WHERE id = 1").bind().first<{ budget_level: number }>())?.budget_level, 0);
      // and a later crossing is a fresh event with its own key
      await seedJournal(d1, 15, "accepted", t - 8, "r");
      assert.deepEqual((await evaluateAlerts(db, t)).raised, ["budget_warning"]);
      assert.deepEqual((await outbox(db)).map((r) => r.event_key), ["budget_warning:1", "budget_warning:2"]);
    });
  });

  test("nextLevel: rises at once, falls one step at a time only after the 5-point margin", () => {
    assert.equal(nextLevel(0, 2, 91, 70, 90), 2);
    assert.equal(nextLevel(2, 1, 88, 70, 90), 2, "88 is inside the margin below critical (85..90)");
    assert.equal(nextLevel(2, 1, 84, 70, 90), 1);
    assert.equal(nextLevel(3, 2, 96, 70, 90), 3, "exhausted holds until clearly below 100");
    assert.equal(nextLevel(3, 0, 10, 70, 90), 0);
  });

  test("two evaluations running at the same moment still raise ONE event (compare-and-set on the episode)", async () => {
    await withD1(async (d1, db) => {
      await configure(d1, 100);
      await seedJournal(d1, 80, "accepted", now() - 10);
      const runs = await Promise.all(Array.from({ length: 6 }, () => evaluateAlerts(db, now())));
      assert.equal(runs.flatMap((r) => r.raised).length, 1);
      assert.equal((await outbox(db)).length, 1);
    });
  });

  test("an unconfigured Worker raises nothing and does not throw", async () => {
    await withD1(async (d1, db) => {
      await seedJournal(d1, 50, "accepted", now() - 10);
      assert.deepEqual(await evaluateAlerts(db, now()), { raised: [], skipped: "unconfigured" });
    });
  });

  test("an abnormal delivery-failure rate raises one event, clears with hysteresis and can re-arm", async () => {
    await withD1(async (d1, db) => {
      await configure(d1, 1000);
      const t = now();
      await seedJournal(d1, 7, "accepted", t - 600); await seedJournal(d1, 3, "failed", t - 600);
      assert.deepEqual((await evaluateAlerts(db, t)).raised, ["failure_rate"], "10 attempts at 30 % failure");
      const p = JSON.parse((await outbox(db))[0]!.payload);
      assert.deepEqual(p, { attempts: 10, failed: 3, failure_percent: 30, window_minutes: 60 });
      assert.deepEqual((await evaluateAlerts(db, t)).raised, [], "no repeat while the rate stays abnormal");
      await seedJournal(d1, 30, "accepted", t - 500, "ok"); // 3 failures of 40 attempts: 8 %, below the 15 % clearing margin
      assert.deepEqual((await evaluateAlerts(db, t)).raised, []);
      assert.equal((await db.prepare("SELECT failure_alert FROM otp_alert_state WHERE id = 1").bind().first<{ failure_alert: number }>())?.failure_alert, 0, "re-armed");
      await seedJournal(d1, 20, "failed", t - 400, "bad");
      assert.deepEqual((await evaluateAlerts(db, t)).raised, ["failure_rate"]);
      assert.deepEqual((await outbox(db)).map((r) => r.event_key), ["failure_rate:1", "failure_rate:2"]);
    });
  });

  test("too few attempts is never abnormal, whatever the percentage", async () => {
    await withD1(async (d1, db) => {
      await configure(d1, 1000);
      await seedJournal(d1, 9, "failed", now() - 60);
      assert.deepEqual((await evaluateAlerts(db, now())).raised, []);
    });
  });
});

describe("alert delivery to the app: signed, idempotent, retried, never touching the send path", () => {
  const capture = () => {
    const calls: Array<{ url: string; body: string; headers: Headers }> = [];
    const mk = (status: number | "throw") => (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body), headers: new Headers(init.headers) });
      if (status === "throw") throw new TypeError("network down");
      return new Response("{}", { status });
    }) as unknown as typeof fetch;
    return { calls, mk };
  };

  test("a pending event is POSTed once with a valid NOTIFY signature (not the admin or send secret), then marked delivered and never resent", async () => {
    await withD1(async (d1, db) => {
      await configure(d1, 100);
      await seedJournal(d1, 75, "accepted", now() - 10);
      await evaluateAlerts(db, now());
      const { calls, mk } = capture();
      const env = envFor(d1);
      assert.deepEqual(await deliverOutbox({ ...env, APP_NOTIFY: { fetch: mk(200) } } as any, db, mk(200), now()), { delivered: 1, failed: 0 });
      assert.equal(calls.length, 1);
      const c = calls[0]!;
      assert.equal(c.url, NOTIFY_URL);
      assert.equal(await verifySignature(c.body, c.headers, NOTIFY_SECRET), true);
      assert.equal(await verifySignature(c.body, c.headers, ADMIN_SECRET), false, "signed with the notify secret only");
      const body = JSON.parse(c.body);
      assert.deepEqual(Object.keys(body).sort(), ["event_key", "kind", "occurred_at", "source_env", "stats"]);
      assert.equal(body.kind, "budget_warning"); assert.equal(body.source_env, "acceptance");
      assert.equal(c.headers.get("webhook-id"), "ntf_budget_warning:1");
      assert.equal((await outbox(db))[0]!.delivered_at !== null, true);
      assert.deepEqual(await deliverOutbox({ ...env, APP_NOTIFY: { fetch: mk(200) } } as any, db, mk(200), now()), { delivered: 0, failed: 0 });
      assert.equal(calls.length, 1, "delivered events are never resent");
    });
  });

  test("a failing app is retried with exponential backoff; the event stays in the outbox (observable) until it is delivered", async () => {
    await withD1(async (d1, db) => {
      await configure(d1, 100);
      await seedJournal(d1, 95, "accepted", now() - 10);
      await evaluateAlerts(db, now());
      const { calls, mk } = capture();
      const env = envFor(d1); const t = now();
      assert.deepEqual(await deliverOutbox({ ...env, APP_NOTIFY: { fetch: mk(500) } } as any, db, mk(500), t), { delivered: 0, failed: 1 });
      let row = (await outbox(db))[0]!;
      assert.equal(row.delivered_at, null); assert.equal(row.attempts, 1); assert.equal(row.last_status, 500); assert.ok(row.next_attempt_at >= t + 60);
      assert.deepEqual(await deliverOutbox({ ...env, APP_NOTIFY: { fetch: mk(200) } } as any, db, mk(200), t + 5), { delivered: 0, failed: 0 }, "not due yet: no hammering");
      assert.equal(calls.length, 1);
      assert.deepEqual(await deliverOutbox({ ...env, APP_NOTIFY: { fetch: mk("throw") } } as any, db, mk("throw"), t + 4000), { delivered: 0, failed: 1 }, "a network error is just another failed attempt");
      row = (await outbox(db))[0]!;
      assert.equal(row.attempts, 2); assert.equal(row.last_status, 0);
      assert.ok(row.next_attempt_at - (t + 4000) >= 120, "the backoff doubles");
      assert.deepEqual(await deliverOutbox({ ...env, APP_NOTIFY: { fetch: mk(200) } } as any, db, mk(200), t + 9000), { delivered: 1, failed: 0 });
      assert.equal((await outbox(db))[0]!.delivered_at !== null, true);
    });
  });

  test("unconfigured, insecure or unreadable notify settings skip delivery and KEEP the events", async () => {
    await withD1(async (d1, db) => {
      await configure(d1, 100);
      await seedJournal(d1, 95, "accepted", now() - 10);
      await evaluateAlerts(db, now());
      const { calls, mk } = capture();
      for (const over of [{ OTP_NOTIFY_URL: undefined }, { OTP_NOTIFY_SIGNING_SECRET: undefined }, { OTP_NOTIFY_URL: "http://app.example/api/internal/whatsapp-otp/notify" }, { OTP_NOTIFY_URL: "not a url" },
        { OTP_NOTIFY_SIGNING_SECRET: { get: async () => { throw new Error("down"); } } }, { OTP_NOTIFY_SIGNING_SECRET: { get: async () => "" } }, { OTP_NOTIFY_SIGNING_SECRET: { get: async () => "whsec_short" } }]) {
        const r = await deliverOutbox({ ...envFor(d1, over as any), APP_NOTIFY: { fetch: mk(200) } } as any, db, mk(200), now());
        assert.equal(r.delivered, 0, JSON.stringify(Object.keys(over)));
      }
      assert.equal(calls.length, 0);
      assert.equal((await outbox(db)).length, 1);
      assert.equal((await outbox(db))[0]!.delivered_at, null);
    });
  });

  test("NOTIFICATION FAILURES NEVER INTERRUPT OTP DELIVERY: sends keep working while the app is down and the outbox is full", async () => {
    await withD1(async (d1, db) => {
      await setDeliverySwitch(d1, true);
      await configure(d1, 200);
      const env = envFor(d1); const meta = mockMeta();
      await seedJournal(d1, 150, "accepted", now() - 10);
      await evaluateAlerts(db, now());
      const { mk } = capture();
      const summary = await runMaintenance({ ...env, APP_NOTIFY: { fetch: mk("throw") } } as any, purge, mk("throw"));
      assert.equal(summary.failed, 1); assert.deepEqual(summary.errors, []);
      for (let n = 1; n <= 3; n++) {
        const res = await handleRequest(await signedSend(goodBody({ delivery_id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` })), env, meta.fetcher);
        assert.equal(res.status, 200, "an OTP is still delivered");
      }
      assert.equal(meta.calls.length, 3);
      // even a database that cannot answer maintenance cannot throw out of it
      const broken = envFor({ prepare() { throw new Error("d1 down"); }, batch() { throw new Error("d1 down"); } });
      const s2 = await runMaintenance({ ...broken, APP_NOTIFY: { fetch: mk("throw") } } as any, purge, mk("throw"));
      assert.ok(s2.errors.length >= 1);
    });
  });

  test("the scheduled() entry point runs maintenance and swallows every failure", async () => {
    await withD1(async (d1) => {
      await configure(d1, 100);
      await seedJournal(d1, 80, "accepted", now() - 10);
      const pending: Promise<unknown>[] = [];
      worker.scheduled({ scheduledTime: Date.now(), cron: "* * * * *" }, envFor(d1, { OTP_NOTIFY_URL: undefined }), { waitUntil: (p) => { pending.push(p); } });
      const settled = await Promise.allSettled(pending);
      assert.ok(settled.every((s) => s.status === "fulfilled"));
      assert.equal((await d1.prepare("SELECT COUNT(*) AS n FROM otp_notification_outbox").first<{ n: number }>())?.n, 1, "the evaluation still ran");
    });
  });
});

describe("retention", () => {
  test("old journal rows, replay claims and delivered events are purged; undelivered events and the audit history are kept", async () => {
    await withD1(async (d1, db) => {
      await configure(d1, 100);
      const t = now();
      await seedJournal(d1, 5, "accepted", t - 8 * 86_400, "old"); await seedJournal(d1, 5, "accepted", t - 100, "new");
      await d1.prepare("INSERT INTO otp_admin_requests (request_hash, created_at) VALUES (?1, ?2), (?3, ?4)").bind("a".repeat(64), t - 2 * 86_400, "b".repeat(64), t - 10).run();
      await d1.prepare("INSERT INTO otp_notification_outbox (event_key, kind, payload, created_at, delivered_at, next_attempt_at) VALUES ('budget_warning:90', 'budget_warning', '{}', ?1, ?2, ?1), ('budget_warning:91', 'budget_warning', '{}', ?1, NULL, ?1)").bind(t - 40 * 86_400, t - 39 * 86_400).run();
      await d1.prepare("INSERT INTO otp_settings_audit (at, request_id, actor, kind, new_daily_limit, new_hard_ceiling, new_warn_percent, new_critical_percent, new_version, reason) VALUES (?1, 'req-old-0001', ?2, 'initialize', 100, 5000, 70, 90, 1, 'Initial limits for the record')").bind(t - 400 * 86_400, "11111111-2222-4333-8444-555555555555").run();
      const summary = await runMaintenance(envFor(d1, { OTP_NOTIFY_URL: undefined }), purge);
      assert.equal(summary.purged, true);
      assert.equal((await d1.prepare("SELECT COUNT(*) AS n FROM whatsapp_hook_events").first<{ n: number }>())?.n, 5);
      assert.equal((await d1.prepare("SELECT COUNT(*) AS n FROM otp_admin_requests").first<{ n: number }>())?.n, 1);
      assert.deepEqual((await outbox(db)).map((r) => r.event_key), ["budget_warning:91"]);
      assert.equal((await d1.prepare("SELECT COUNT(*) AS n FROM otp_settings_audit").first<{ n: number }>())?.n, 1, "the audit history is never purged");
    });
  });
});
