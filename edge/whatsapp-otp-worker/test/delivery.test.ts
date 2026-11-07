import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { handleRequest } from "../src/index.ts";
import { goodBody, mockMeta, signedSend } from "./support.ts";
import { ACTOR, ADMIN_BYTES, DELIVERY_PATH, OTHER_ACTOR, USAGE_PATH, adminCall, configure, deliveryBody, deliveryGrantFor, envFor, setDeliverySwitch, setDeliverySwitchUnaudited, usageBody, withD1 } from "./d1.ts";

const json = async (r: Response) => (await r.json()) as Record<string, any>;
const flagRow = (db: any) => db.prepare("SELECT enabled, version, updated_by FROM otp_delivery_switch WHERE id = 1").bind().first();
const auditRows = (db: any) => db.prepare("SELECT actor, old_enabled, new_enabled, new_version, reason FROM otp_delivery_audit ORDER BY id").bind().all().then((r: any) => r.results);

describe("delivery switch: persisted in D1, fail closed on every path", () => {
  test("no row, an OFF row, or an unreadable table all refuse to send, and Meta is never called", async () => {
    await withD1(async (d1) => {
      await configure(d1);
      const meta = mockMeta();
      const env = envFor(d1);
      const none = await handleRequest(await signedSend(goodBody()), env, meta.fetcher);
      assert.equal(none.status, 503);
      assert.deepEqual(await json(none), { error: "delivery_disabled" });
      await setDeliverySwitch(d1, false);
      const off = await handleRequest(await signedSend(goodBody()), env, meta.fetcher);
      assert.equal(off.status, 503);
      assert.deepEqual(await json(off), { error: "delivery_disabled" });
      await d1.prepare("DROP TABLE otp_delivery_switch").run();
      const broken = await handleRequest(await signedSend(goodBody()), env, meta.fetcher);
      assert.equal(broken.status, 503);
      assert.deepEqual(await json(broken), { error: "delivery_disabled" });
      assert.equal(meta.calls.length, 0);
    });
  });

  test("the switch ON still needs the environment permit: WHATSAPP_DELIVERY_ENABLED other than true sends nothing", async () => {
    await withD1(async (d1) => {
      await configure(d1);
      await setDeliverySwitch(d1, true);
      const meta = mockMeta();
      const res = await handleRequest(await signedSend(goodBody()), envFor(d1, { WHATSAPP_DELIVERY_ENABLED: "false" }), meta.fetcher);
      assert.equal(res.status, 503);
      assert.equal(meta.calls.length, 0);
    });
  });

  test("switch ON + permit + settings: the send path proceeds; flipping OFF takes effect on the very next request", async () => {
    await withD1(async (d1) => {
      await configure(d1);
      await setDeliverySwitch(d1, true);
      const meta = mockMeta();
      const env = envFor(d1);
      assert.equal((await handleRequest(await signedSend(goodBody()), env, meta.fetcher)).status, 200);
      await setDeliverySwitch(d1, false, 2);
      const second = goodBody({ delivery_id: "7c2e5d2d-1e4b-4d6f-8b88-3a7e4a1b0c22" });
      assert.equal((await handleRequest(await signedSend(second), env, meta.fetcher)).status, 503);
      assert.equal(meta.calls.length, 1);
    });
  });
});

describe("a change made directly in D1 never turns delivery on, and is reported", () => {
  test("an ON row with no audit row (a direct write) sends nothing, Meta is never called, and the usage report names the drift", async () => {
    await withD1(async (d1) => {
      await configure(d1);
      await setDeliverySwitchUnaudited(d1, true, 3);
      const meta = mockMeta();
      const env = envFor(d1);
      const res = await handleRequest(await signedSend(goodBody()), env, meta.fetcher);
      assert.equal(res.status, 503);
      assert.deepEqual(await json(res), { error: "delivery_disabled" });
      assert.equal(meta.calls.length, 0);
      const usage = await json(await adminCall(env, USAGE_PATH, usageBody()));
      assert.deepEqual(usage.delivery_drift, { version: 3, at: 1700000000 });
      assert.equal(usage.delivery.enabled, true, "the report shows the stored row honestly...");
      assert.equal(usage.runtime.delivery_enabled, false, "...while the effective state is OFF");
    });
  });

  test("tampering after a legitimate ON (flip the flag back on at the same version, or delete the audit trail) leaves delivery OFF", async () => {
    await withD1(async (d1) => {
      await configure(d1);
      const env = envFor(d1);
      const meta = mockMeta();
      assert.equal((await adminCall(env, DELIVERY_PATH, deliveryBody())).status, 200);
      assert.equal((await handleRequest(await signedSend(goodBody()), env, meta.fetcher)).status, 200);
      // 1. a legitimate OFF through the route, then a direct "enabled = 1" that keeps the version: the audit says OFF, so it stays OFF
      assert.equal((await adminCall(env, DELIVERY_PATH, deliveryBody({ expected_version: 1, enabled: false, reason: "Closing the window after the rehearsal" }))).status, 200);
      await d1.prepare("UPDATE otp_delivery_switch SET enabled = 1 WHERE id = 1").run();
      const second = goodBody({ delivery_id: "7c2e5d2d-1e4b-4d6f-8b88-3a7e4a1b0c22" });
      assert.equal((await handleRequest(await signedSend(second), env, meta.fetcher)).status, 503);
      const usage = await json(await adminCall(env, USAGE_PATH, usageBody()));
      assert.deepEqual(usage.delivery_drift, { version: 2, at: usage.delivery_drift.at });
      // 2. the audit trail removed under an ON switch: also OFF
      await d1.prepare("DELETE FROM otp_delivery_audit").run();
      const third = goodBody({ delivery_id: "9d3f6e3e-2f5c-4e70-9c99-4b8f5b2c1d33" });
      assert.equal((await handleRequest(await signedSend(third), env, meta.fetcher)).status, 503);
      assert.equal(meta.calls.length, 1, "only the one audited send ever reached Meta");
    });
  });

  test("a consistent, audited switch reports no drift", async () => {
    await withD1(async (d1) => {
      await configure(d1);
      const env = envFor(d1);
      assert.equal((await adminCall(env, DELIVERY_PATH, deliveryBody())).status, 200);
      assert.equal((await json(await adminCall(env, USAGE_PATH, usageBody()))).delivery_drift, null);
    });
  });
});

describe("POST /v1/admin/delivery: the grant-protected, audited toggle", () => {
  test("enabling records actor, old value, new value, reason and time atomically with the flag; the first change needs expected_version 0", async () => {
    await withD1(async (d1, db) => {
      await configure(d1);
      const env = envFor(d1);
      assert.deepEqual(await json(await adminCall(env, DELIVERY_PATH, deliveryBody({ expected_version: 4 }))), { error: "stale_version", current_version: 0 });
      assert.deepEqual(await json(await adminCall(env, DELIVERY_PATH, deliveryBody({ reason: "short" }))), { error: "reason_too_short" });
      const res = await adminCall(env, DELIVERY_PATH, deliveryBody());
      assert.equal(res.status, 200);
      const out = await json(res);
      assert.equal(out.status, "applied");
      assert.equal(out.version, 1);
      assert.equal(out.old, null);
      assert.equal(out.new.enabled, true);
      assert.deepEqual(await flagRow(db), { enabled: 1, version: 1, updated_by: ACTOR });
      assert.deepEqual(await auditRows(db), [{ actor: ACTOR, old_enabled: null, new_enabled: 1, new_version: 1, reason: "Acceptance rehearsal window approved" }]);
      // turning it OFF records OLD=1 NEW=0 and is attributed to the second administrator
      const off = await adminCall(env, DELIVERY_PATH, deliveryBody({ expected_version: 1, enabled: false, actor_id: OTHER_ACTOR, reason: "Window closed, switching delivery off" }));
      assert.equal(off.status, 200);
      assert.deepEqual((await auditRows(db))[1], { actor: OTHER_ACTOR, old_enabled: 1, new_enabled: 0, new_version: 2, reason: "Window closed, switching delivery off" });
      assert.deepEqual(await json(await adminCall(env, DELIVERY_PATH, deliveryBody({ expected_version: 2, enabled: false }))), { error: "no_change" });
    });
  });

  test("enabling is refused while any prerequisite is missing (and writes nothing); turning OFF is always allowed", async () => {
    const cases: [string, boolean, Record<string, unknown>, string][] = [
      ["environment permit", true, { WHATSAPP_DELIVERY_ENABLED: "false" }, "environment_not_permitted"],
      ["limits not initialized", false, {}, "settings_not_initialized"],
      ["Meta token", true, { WHATSAPP_ACCESS_TOKEN: { get: async () => "" } }, "meta_token_missing"],
      ["alert callback", true, { OTP_NOTIFY_URL: undefined }, "notify_not_configured"],
      ["recipients", true, { OTP_ALLOWED_RECIPIENTS: "" }, "recipients_not_configured"],
    ];
    for (const [name, withSettings, envOver, blocker] of cases) {
      await withD1(async (d1, db) => {
        if (withSettings) await configure(d1);
        const res = await adminCall(envFor(d1, envOver as never), DELIVERY_PATH, deliveryBody());
        assert.equal(res.status, 422, name);
        const body = await json(res);
        assert.equal(body.error, "prerequisites_missing", name);
        assert.ok(String(body.missing).split(",").includes(blocker), `${name}: ${JSON.stringify(body)}`);
        assert.equal(await flagRow(db), null, name);
        assert.deepEqual(await auditRows(db), [], name);
      });
    }
    await withD1(async (d1, db) => {
      await configure(d1);
      const res = await adminCall(envFor(d1, { OTP_ADMIN_GRANT_SECRET: undefined }), DELIVERY_PATH, deliveryBody());
      assert.equal(res.status, 503); // no grant key: nothing can be authorized at all
      assert.equal(await flagRow(db), null);
    });
    await withD1(async (d1, db) => {
      await setDeliverySwitch(d1, true); // ON, with nothing else configured
      const res = await adminCall(envFor(d1, { WHATSAPP_DELIVERY_ENABLED: "false", OTP_NOTIFY_URL: undefined }), DELIVERY_PATH, deliveryBody({ expected_version: 1, enabled: false }));
      assert.equal(res.status, 200);
      assert.equal(((await flagRow(db)) as { enabled: number }).enabled, 0);
    });
  });

  test("a request without a valid database grant cannot change the flag: missing, forged key, tampered fields, expired, replay", async () => {
    await withD1(async (d1, db) => {
      await configure(d1);
      const env = envFor(d1);
      const none = deliveryBody() as Record<string, unknown>;
      delete none.grant;
      delete none.grant_expires;
      assert.equal((await adminCall(env, DELIVERY_PATH, none)).status, 400);
      const forged = deliveryBody();
      Object.assign(forged, deliveryGrantFor(forged, { bytes: ADMIN_BYTES }));
      assert.deepEqual(await json(await adminCall(env, DELIVERY_PATH, forged)), { error: "grant_invalid" });
      const tampers: [string, (b: Record<string, any>) => void][] = [
        ["enabled", (b) => { b.enabled = false; }],
        ["actor", (b) => { b.actor_id = OTHER_ACTOR; }],
        ["version", (b) => { b.expected_version = 1; }],
        ["reason", (b) => { b.reason = "Another reason nobody approved"; }],
        ["request id", (b) => { b.request_id = crypto.randomUUID(); }],
        ["expiry", (b) => { b.grant_expires += 30; }],
      ];
      for (const [name, mutate] of tampers) {
        const b = deliveryBody() as Record<string, any>;
        mutate(b);
        assert.equal((await adminCall(env, DELIVERY_PATH, b)).status, 403, name);
      }
      const expired = deliveryBody();
      Object.assign(expired, deliveryGrantFor(expired, { expires: Math.floor(Date.now() / 1000) - 5 }));
      assert.equal((await adminCall(env, DELIVERY_PATH, expired)).status, 403);
      assert.equal(await flagRow(db), null);
      const ok = deliveryBody();
      assert.equal((await adminCall(env, DELIVERY_PATH, ok)).status, 200);
      assert.equal((await adminCall(env, DELIVERY_PATH, ok)).status, 409); // the same signed request can never apply twice
      assert.equal((await auditRows(db)).length, 1);
    });
  });

  test("CONCURRENT toggles on one version: exactly one wins and only one audit row exists", async () => {
    await withD1(async (d1, db) => {
      await configure(d1);
      const env = envFor(d1);
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => adminCall(env, DELIVERY_PATH, deliveryBody({ reason: `Concurrent enable number ${i}` }))));
      const statuses = results.map((r) => r.status).sort();
      assert.equal(statuses.filter((s) => s === 200).length, 1, JSON.stringify(statuses));
      assert.equal((await auditRows(db)).length, 1);
    });
  });

  test("the usage report carries the switch, its version and history, and the runtime facts name what blocks it", async () => {
    await withD1(async (d1) => {
      const env = envFor(d1, { OTP_NOTIFY_URL: undefined });
      let body = await json(await adminCall(env, USAGE_PATH, usageBody()));
      assert.deepEqual(body.delivery, { enabled: false, version: 0, updated_at: null, updated_by: null });
      assert.equal(body.runtime.delivery_enabled, false);
      assert.equal(body.runtime.delivery_permitted, true);
      const blockers = String(body.runtime.delivery_blockers).split(",");
      assert.ok(blockers.includes("settings_not_initialized"));
      assert.ok(blockers.includes("notify_not_configured"));
      await configure(d1);
      const ready = envFor(d1);
      assert.equal((await adminCall(ready, DELIVERY_PATH, deliveryBody())).status, 200);
      body = await json(await adminCall(ready, USAGE_PATH, usageBody()));
      assert.equal(body.delivery.enabled, true);
      assert.equal(body.delivery.version, 1);
      assert.equal(body.runtime.delivery_enabled, true);
      assert.equal(body.runtime.delivery_blockers, "");
      assert.equal(body.delivery_audit.length, 1);
      assert.deepEqual({ ...body.delivery_audit[0], at: 0, request_id: "x" }, { at: 0, request_id: "x", actor: ACTOR, old: null, new: true, version: 1, reason: "Acceptance rehearsal window approved" });
    });
  });
});
