import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { handleRequest } from "../src/index.ts";
import { ATTEST_PATH, attestationCanonical, deliveryEffectivelyOn, runAttestation } from "../src/attest.ts";
import { runMaintenance } from "../src/maintenance.ts";
import { signPayload } from "../src/signing.ts";
import { goodBody, mockMeta, signedSend } from "./support.ts";
import { ACTOR, DELIVERY_PATH, NOTIFY_SECRET, adminCall, configure, deliveryBody, envFor, setAttestation, setDeliverySwitch, withD1 } from "./d1.ts";

const now = () => Math.floor(Date.now() / 1000);
const send = async (env: any, meta: ReturnType<typeof mockMeta>, id = "7c2e5d2d-1e4b-4d6f-8b88-3a7e4a1b0c22") =>
  (await handleRequest(await signedSend(goodBody({ delivery_id: id })), env, meta.fetcher)).status;

describe("the switch is ON only with a fresh, correctly signed attestation from the Aladdin database", () => {
  test("an audited ON switch with no attestation, a stale one, a forged one, another environment's, or another version's sends nothing", async () => {
    await withD1(async (d1) => {
      await configure(d1);
      const env = envFor(d1);
      const meta = mockMeta();
      await setDeliverySwitch(d1, true, 1);
      await d1.prepare("DELETE FROM otp_delivery_attestation").run();
      assert.equal(await send(env, meta), 503, "no attestation");
      await setAttestation(d1, true, 1, { issuedAt: now() - 601 });
      assert.equal(await send(env, meta), 503, "older than the TTL");
      await setAttestation(d1, true, 1, { secret: "whsec_" + btoa(String.fromCharCode(...new Uint8Array(32).fill(9))) });
      assert.equal(await send(env, meta), 503, "signed with a key the app does not have");
      await setAttestation(d1, true, 1, { env: "production" });
      assert.equal(await send(env, meta), 503, "attestation for another environment");
      await setAttestation(d1, true, 2);
      assert.equal(await send(env, meta), 503, "attestation for another version");
      await setAttestation(d1, false, 1);
      assert.equal(await send(env, meta), 503, "the app says OFF at this version");
      await setAttestation(d1, true, 1, { issuedAt: now() + 3600 });
      assert.equal(await send(env, meta), 503, "issued in the future");
      assert.equal(meta.calls.length, 0, "Meta was never called");
      await setAttestation(d1, true, 1);
      assert.equal(await send(env, meta), 200, "the genuine attestation lets it through");
    });
  });

  test("a forged switch row AND a forged audit row, with no valid attestation, cannot send; an unreadable secret is OFF too", async () => {
    await withD1(async (d1) => {
      await configure(d1);
      const meta = mockMeta();
      // everything an attacker with D1 write access can produce: consistent switch, consistent audit, even a made-up attestation row
      await d1.prepare("INSERT INTO otp_delivery_switch (id, enabled, version, updated_at, updated_by) VALUES (1, 1, 9, 1700000000, ?1)").bind(ACTOR).run();
      await d1.prepare("INSERT INTO otp_delivery_audit (at, request_id, actor, old_enabled, new_enabled, new_version, reason) VALUES (1700000000, ?1, ?2, 0, 1, 9, 'forged by direct D1 write')").bind(crypto.randomUUID(), ACTOR).run();
      await d1.prepare("INSERT INTO otp_delivery_attestation (id, enabled, version, issued_at, nonce, mac) VALUES (1, 1, 9, ?1, ?2, ?3)").bind(now(), "cd".repeat(16), "v1," + "A".repeat(43) + "=").run();
      assert.equal(await send(envFor(d1), meta), 503);
      assert.equal(meta.calls.length, 0);
      // and with the genuine attestation present but the secret unreadable or missing: still OFF (fail closed)
      await setAttestation(d1, true, 9);
      assert.equal(await send(envFor(d1, { OTP_NOTIFY_SIGNING_SECRET: { get: async () => { throw new Error("denied"); } } }), meta), 503);
      assert.equal(await send(envFor(d1, { OTP_NOTIFY_SIGNING_SECRET: undefined }), meta), 503);
      assert.equal(meta.calls.length, 0);
    });
  });

  test("OFF never needs an attestation (a stale attestation cannot keep delivery on)", async () => {
    await withD1(async (d1) => {
      await configure(d1);
      await setDeliverySwitch(d1, false, 2);
      assert.equal(await deliveryEffectivelyOn(envFor(d1) as never, d1 as never, now()), false);
    });
  });
});

/** Plays the app's side: answers like the route does, with the real signing (the app's own tests cover its verification). */
function app(opts: { authorized?: { enabled: boolean; version: number }; status?: number; badMac?: boolean; badNonce?: boolean; staleBy?: number; capture?: { body?: any; url?: string } } = {}) {
  return {
    fetch: async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (opts.capture) { opts.capture.body = body; opts.capture.url = url; }
      if (opts.status) return new Response(null, { status: opts.status });
      const a = opts.authorized ?? { enabled: false, version: 0 };
      const issuedAt = now() - (opts.staleBy ?? 0);
      const nonce = opts.badNonce ? "ee".repeat(16) : body.nonce;
      const mac = opts.badMac ? "v1," + "B".repeat(43) + "=" : (await signPayload(NOTIFY_SECRET, "attest", issuedAt, attestationCanonical({ env: "acceptance", ...a, issuedAt, nonce })))!;
      return Response.json({ authorized: a, issued_at: issuedAt, nonce, mac });
    },
  };
}
const stored = (d1: any) => d1.prepare("SELECT enabled, version FROM otp_delivery_attestation WHERE id = 1").bind().first();

describe("the scheduled attestation round trip", () => {
  test("sends the state and audit tail over the private binding to the delivery-attest path, stores only a verified answer, and then ON takes effect", async () => {
    await withD1(async (d1) => {
      await configure(d1);
      await setDeliverySwitch(d1, true, 1);
      await d1.prepare("DELETE FROM otp_delivery_attestation").run();
      const cap: { body?: any; url?: string } = {};
      const env = envFor(d1, { APP_NOTIFY: app({ authorized: { enabled: true, version: 1 }, capture: cap }) as never });
      assert.equal(await deliveryEffectivelyOn(env as never, d1 as never, now()), false, "not yet attested");
      assert.deepEqual(await runAttestation(env as never, d1 as never, fetch, now()), { attested: true });
      assert.equal(new URL(cap.url!).pathname, ATTEST_PATH);
      assert.equal(cap.body.source_env, "acceptance");
      assert.deepEqual(cap.body.switch, { enabled: true, version: 1, updated_at: 0 });
      assert.equal(cap.body.audit.length, 1);
      assert.deepEqual(await stored(d1), { enabled: 1, version: 1 });
      assert.equal(await deliveryEffectivelyOn(env as never, d1 as never, now()), true);
    });
  });

  test("an app that says OFF (or another version) is stored as such: a forged ON stays OFF and the next send is refused", async () => {
    await withD1(async (d1) => {
      await configure(d1);
      await setDeliverySwitch(d1, true, 9); // forged ON, version 9
      const env = envFor(d1, { APP_NOTIFY: app({ authorized: { enabled: false, version: 2 } }) as never });
      assert.deepEqual(await runAttestation(env as never, d1 as never, fetch, now()), { attested: true });
      assert.deepEqual(await stored(d1), { enabled: 0, version: 2 });
      assert.equal(await send(env, mockMeta()), 503);
    });
  });

  test("an unsigned, wrongly signed, replayed-nonce, stale, failing or absent answer stores nothing and never throws", async () => {
    await withD1(async (d1) => {
      await configure(d1);
      await setDeliverySwitch(d1, true, 1);
      await d1.prepare("DELETE FROM otp_delivery_attestation").run();
      for (const [label, binding] of [["bad mac", app({ badMac: true })], ["nonce of another request", app({ badNonce: true })], ["stale answer", app({ staleBy: 400 })], ["app 503", app({ status: 503 })], ["app 401", app({ status: 401 })]] as const) {
        const r = await runAttestation(envFor(d1, { APP_NOTIFY: binding as never }) as never, d1 as never, fetch, now());
        assert.equal(r.attested, false, label);
        assert.equal(await stored(d1), null, label);
      }
      assert.deepEqual(await runAttestation(envFor(d1, { APP_NOTIFY: undefined }) as never, d1 as never, fetch, now()), { attested: false, skipped: "notify_transport_unavailable" }, "no binding: nothing sent, no public fetch");
      assert.deepEqual(await runAttestation(envFor(d1, { OTP_NOTIFY_URL: undefined, APP_NOTIFY: app() as never }) as never, d1 as never, fetch, now()), { attested: false, skipped: "notify_unconfigured" });
      const throwing = { fetch: async () => { throw new Error("service unavailable"); } };
      assert.equal((await runAttestation(envFor(d1, { APP_NOTIFY: throwing as never }) as never, d1 as never, fetch, now())).attested, false);
    });
  });

  test("the scheduled maintenance runs it and reports it", async () => {
    await withD1(async (d1) => {
      await configure(d1);
      const env = envFor(d1, { APP_NOTIFY: app({ authorized: { enabled: false, version: 0 } }) as never });
      const summary = await runMaintenance(env as never, async () => undefined, fetch);
      assert.equal(summary.attested, true);
      assert.deepEqual(summary.errors, []);
    });
  });
});

describe("monitoring: a failed attestation leaves one structured line with a fixed reason code and nothing else", () => {
  test("app 503, unsigned answer, no transport and unreachable app are each logged; a success logs nothing", async () => {
    await withD1(async (d1) => {
      await configure(d1);
      const lines: string[] = [];
      const warn = console.warn;
      console.warn = (m: unknown) => { lines.push(String(m)); };
      try {
        const run = (over: object) => runMaintenance(envFor(d1, over as never) as never, async () => undefined, fetch);
        await run({ APP_NOTIFY: app({ status: 503 }) });
        await run({ APP_NOTIFY: app({ badMac: true }) });
        await run({ APP_NOTIFY: undefined });
        await run({ APP_NOTIFY: { fetch: async () => { throw new Error("secret-looking-detail whsec_x"); } } });
        const before = lines.length;
        await run({ APP_NOTIFY: app({ authorized: { enabled: false, version: 0 } }) });
        assert.equal(lines.filter((l) => l.includes("attestation")).length, before, "a success adds no attestation line");
      } finally { console.warn = warn; }
      const events = lines.map((l) => JSON.parse(l)).filter((e) => e.event === "whatsapp_otp_attestation_failed");
      assert.deepEqual(events.map((e) => e.reason), ["app_503", "answer_unsigned", "notify_transport_unavailable", "attest_failed"]);
      assert.ok(events.every((e) => Object.keys(e).sort().join() === "event,reason"), "only an event name and a reason code");
      assert.ok(!lines.join("").includes("whsec_") && !lines.join("").includes("secret-looking"));
    });
  });
});

describe("the Admin switch controls daily ON/OFF with no redeploy once the environment permit is enabled", () => {
  test("ON through the audited route + the next attestation, OFF immediately, ON again: one env object throughout, the permit never touched", async () => {
    await withD1(async (d1) => {
      await configure(d1);
      // The Aladdin database's side, simplified: it authorizes whatever the audited route last applied (the real app reads its ledger).
      let authorized = { enabled: false, version: 0 };
      const binding = { fetch: async (_u: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        const issuedAt = now();
        const mac = (await signPayload(NOTIFY_SECRET, "attest", issuedAt, attestationCanonical({ env: "acceptance", ...authorized, issuedAt, nonce: body.nonce })))!;
        return Response.json({ authorized, issued_at: issuedAt, nonce: body.nonce, mac });
      } };
      const env = envFor(d1, { WHATSAPP_DELIVERY_ENABLED: "true", APP_NOTIFY: binding as never }); // the permit is on and is never changed below
      const meta = mockMeta();
      const cron = () => runMaintenance(env as never, async () => undefined, fetch);
      const ids = ["7c2e5d2d-1e4b-4d6f-8b88-3a7e4a1b0c01", "7c2e5d2d-1e4b-4d6f-8b88-3a7e4a1b0c02", "7c2e5d2d-1e4b-4d6f-8b88-3a7e4a1b0c03", "7c2e5d2d-1e4b-4d6f-8b88-3a7e4a1b0c04"];

      assert.equal(await send(env, meta, ids[0]), 503, "a fresh deployment sends nothing: no switch row");
      assert.equal((await adminCall(env, DELIVERY_PATH, deliveryBody())).status, 200); // Super Admin turns ON (v1)
      authorized = { enabled: true, version: 1 };
      assert.equal(await send(env, meta, ids[0]), 503, "ON is not effective before the Aladdin database has attested it");
      assert.equal((await cron()).attested, true);
      assert.equal(await send(env, meta, ids[0]), 200, "after the next attestation it sends: no redeploy");

      assert.equal((await adminCall(env, DELIVERY_PATH, deliveryBody({ expected_version: 1, enabled: false, reason: "Closing the window for today" }))).status, 200); // OFF (v2)
      assert.equal(await send(env, meta, ids[1]), 503, "OFF takes effect on the very next request, with the old ON attestation still fresh");
      authorized = { enabled: false, version: 2 };
      await cron();
      assert.equal(await send(env, meta, ids[1]), 503);

      assert.equal((await adminCall(env, DELIVERY_PATH, deliveryBody({ expected_version: 2, enabled: true, reason: "Opening the window tomorrow" }))).status, 200); // ON again (v3)
      authorized = { enabled: true, version: 3 };
      assert.equal(await send(env, meta, ids[2]), 503, "the v1 attestation is useless for v3");
      await cron();
      assert.equal(await send(env, meta, ids[2]), 200);
      assert.equal(meta.calls.length, 2);
      // the emergency kill switch is independent: with the permit off the same state sends nothing
      assert.equal(await send({ ...env, WHATSAPP_DELIVERY_ENABLED: "false" }, meta, ids[3]), 503);
      assert.equal(meta.calls.length, 2);
    });
  });
});
