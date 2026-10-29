import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeMac, parseKeyring } from "./otp";
import type { PhoneVerificationDb } from "./service";
import { createPhoneSignupService, signupCreateUserPayload } from "./signup-service";
import { createFakeTransport, type PhoneOtpTransport } from "./transport";

const REG = "33333333-3333-4333-8333-333333333333";
const CH = "11111111-1111-4111-8111-111111111111";
const GRANT = "44444444-4444-4444-8444-444444444444";
const USER = "22222222-2222-4222-8222-222222222222";
const PHONE = "+201000000077";
const keyring = parseKeyring(JSON.stringify({ current: "k2", keys: { k2: randomBytes(32).toString("base64"), k1: randomBytes(32).toString("base64") } }));

type Responder = unknown | ((args: Record<string, unknown>) => { data: unknown; error: null });
function harness(responses: Record<string, Responder>, opts: { enabled?: boolean; failTransport?: boolean; transport?: PhoneOtpTransport } = {}) {
  const tasks: Promise<void>[] = [];
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db: PhoneVerificationDb = {
    async rpc(fn, args) {
      calls.push({ fn, args });
      const r = responses[fn];
      return typeof r === "function" ? (r as (a: Record<string, unknown>) => { data: unknown; error: null })(args) : { data: r ?? null, error: null };
    },
  };
  const fake = createFakeTransport(opts.failTransport ? { failWith: new Error(`upstream rejected ${PHONE}`) } : {});
  const service = createPhoneSignupService({ db, transport: opts.transport ?? fake.transport, keyring, enabled: opts.enabled ?? true, defer: (t) => { tasks.push(t); } });
  const flush = async () => { await Promise.all(tasks.splice(0)); };
  return { service, calls, fake, flush };
}
const created = (deliver: boolean) => (args: Record<string, unknown>) => ({
  data: { status: "challenge_created", challenge_id: args.p_challenge_id, expires_at: "2026-10-30T10:05:00Z", resend_available_at: "2026-10-30T10:01:00Z", deliver, phone_e164: PHONE },
  error: null,
});

describe("signup service", () => {
  it("OFF: nothing is generated, no database call, nothing delivered", async () => {
    const { service, calls, fake } = harness({}, { enabled: false });
    expect(await service.start(REG, PHONE, "203.0.113.9")).toEqual({ status: "unavailable" });
    expect(await service.verify(REG, CH, "123456", null)).toEqual({ status: "unavailable" });
    expect(await service.attach(USER, GRANT)).toEqual({ status: "unavailable" });
    expect(calls).toHaveLength(0);
    expect(fake.sent).toHaveLength(0);
  });

  it("start: the database gets a MAC bound to the REGISTRATION, never the code or the address; the code goes to the adapter only", async () => {
    const { service, calls, fake, flush } = harness({ phone_signup_start: created(true) });
    const out = await service.start(REG, PHONE, "203.0.113.9");
    expect(out.status).toBe("sent");
    await flush();
    expect(fake.sent).toHaveLength(1);
    const { code, to, purpose } = fake.sent[0]!;
    expect(to).toBe(PHONE);
    expect(purpose).toBe("signup_proof");
    const args = calls[0]!.args;
    expect(JSON.stringify(args)).not.toContain(code);
    expect(JSON.stringify(args)).not.toContain("203.0.113.9");
    expect(args.p_code_mac).toBe(computeMac(keyring.keys.get(String(args.p_kid))!, { challengeId: String(args.p_challenge_id), registrationId: REG, purpose: "signup_proof" }, code));
  });

  it("start: a number that already has an account gets the IDENTICAL reply and no message", async () => {
    const taken = harness({ phone_signup_start: created(false) });
    const free = harness({ phone_signup_start: created(true) });
    const a = await taken.service.start(REG, PHONE, null);
    const b = await free.service.start(REG, PHONE, null);
    await taken.flush();
    await free.flush();
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    expect(a.status).toBe("sent");
    expect(taken.fake.sent).toHaveLength(0);
    expect(free.fake.sent).toHaveLength(1);
  });

  it("start: malformed ids or numbers never reach the database", async () => {
    const { service, calls } = harness({ phone_signup_start: created(true) });
    expect(await service.start("not-a-uuid", PHONE, null)).toEqual({ status: "unavailable" });
    expect(await service.start(REG, "0100000077", null)).toEqual({ status: "unavailable" });
    expect(await service.start(REG, "+20 100 000 0077", null)).toEqual({ status: "unavailable" });
    expect(calls).toHaveLength(0);
  });

  it("start: a delivery failure is INVISIBLE in the reply (same as success), closes the challenge afterwards, and leaks nothing", async () => {
    const ok = harness({ phone_signup_start: created(true) });
    const bad = harness({ phone_signup_start: created(true), phone_signup_invalidate: true }, { failTransport: true });
    const replyOk = await ok.service.start(REG, PHONE, null);
    const replyBad = await bad.service.start(REG, PHONE, null);
    expect(Object.keys(replyBad).sort()).toEqual(Object.keys(replyOk).sort());
    expect(replyBad.status).toBe("sent");
    await bad.flush();
    expect(bad.calls.map((c) => c.fn)).toEqual(["phone_signup_start", "phone_signup_invalidate"]);
    expect(JSON.stringify(bad.calls[1]!.args)).toContain("delivery_failed");
    expect(JSON.stringify(replyBad)).not.toContain(PHONE);
  });

  it("start: the reply does NOT wait for delivery, so response time cannot tell a taken number from a free one", async () => {
    let release: () => void = () => undefined;
    const slow: PhoneOtpTransport = { send: () => new Promise<void>((resolve) => { release = resolve; }) };
    const { service, fake, flush } = harness({ phone_signup_start: created(true) }, { transport: slow });
    const started = await Promise.race([service.start(REG, PHONE, null), new Promise<"blocked">((r) => setTimeout(() => r("blocked"), 500))]);
    expect(started).not.toBe("blocked");   // returned although the send has not completed
    release();
    await flush();
    expect(fake.sent).toHaveLength(0);      // (the slow transport records nothing; the point is only that start() did not wait)
  });

  it("start: rate limiting and database errors map to coarse outcomes", async () => {
    expect(await harness({ phone_signup_start: { status: "rate_limited", retry_after_seconds: 42 } }).service.start(REG, PHONE, null)).toEqual({ status: "rate_limited", retryAfterSeconds: 42 });
    expect(await harness({ phone_signup_start: { status: "unavailable" } }).service.start(REG, PHONE, null)).toEqual({ status: "unavailable" });
    expect(await harness({ phone_signup_start: () => ({ data: null, error: { code: "XX000" } as never }) }).service.start(REG, PHONE, null)).toEqual({ status: "unavailable" });
  });

  it("verify: offers one MAC per accepted key id, all bound to the registration; returns the grant", async () => {
    const { service, calls } = harness({ phone_signup_verify: { status: "verified", grant_id: GRANT, alias: "p201000000077@craftsman-login.aladdin.invalid", phone_e164: PHONE, expires_at: "2026-10-30T10:15:00Z" } });
    const out = await service.verify(REG, CH, "123456", "198.51.100.7");
    expect(out).toEqual({ status: "verified", grant: { id: GRANT, registrationId: REG, alias: "p201000000077@craftsman-login.aladdin.invalid", phone: PHONE, expiresAt: "2026-10-30T10:15:00Z" } });
    const cands = calls[0]!.args.p_candidates as Record<string, string>;
    expect(Object.keys(cands).sort()).toEqual(["k1", "k2"]);
    for (const [kid, mac] of Object.entries(cands)) expect(mac).toBe(computeMac(keyring.keys.get(kid)!, { challengeId: CH, registrationId: REG, purpose: "signup_proof" }, "123456"));
    expect(JSON.stringify(calls[0]!.args)).not.toContain("123456");
  });

  it("verify: a malformed code is answered like a wrong one without a database call; every database failure is a bare invalid", async () => {
    const { service, calls } = harness({ phone_signup_verify: { status: "invalid" } });
    expect(await service.verify(REG, CH, "12345", null)).toEqual({ status: "invalid" });
    expect(await service.verify(REG, "bad", "123456", null)).toEqual({ status: "invalid" });
    expect(calls).toHaveLength(0);
    expect(await service.verify(REG, CH, "123456", null)).toEqual({ status: "invalid" });
    const odd = harness({ phone_signup_verify: { status: "verified" } }); // verified without a grant id is not trusted
    expect(await odd.service.verify(REG, CH, "123456", null)).toEqual({ status: "invalid" });
  });

  it("attach: passes only ids and returns coarse outcomes", async () => {
    expect(await harness({ phone_signup_attach: { status: "attached" } }).service.attach(USER, GRANT)).toEqual({ status: "attached" });
    expect(await harness({ phone_signup_attach: { status: "invalid" } }).service.attach(USER, GRANT)).toEqual({ status: "invalid" });
    const { service, calls } = harness({});
    expect(await service.attach("x", GRANT)).toEqual({ status: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("signupCreateUserPayload puts the grant and registration in app_metadata (the only channel a public caller cannot forge)", () => {
    const payload = signupCreateUserPayload(
      { id: GRANT, registrationId: REG, alias: "p201000000077@craftsman-login.aladdin.invalid", phone: PHONE, expiresAt: "x" },
      { password: "pw", fullName: "N", locale: "ar", appMetadata: { registration_source: "phone_whatsapp_sign_up" } },
    );
    expect(payload.app_metadata).toEqual({ registration_source: "phone_whatsapp_sign_up", phone_signup_grant: GRANT, phone_signup_registration: REG });
    expect(payload.user_metadata).not.toHaveProperty("phone_signup_grant");
    expect(payload.email_confirm).toBe(true);
  });
});
