import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseKeyring } from "./otp";
import { createPhoneVerificationService, type PhoneVerificationDb } from "./service";
import { createFakeTransport, disabledTransport } from "./transport";

const USER = "22222222-2222-4222-8222-222222222222";
const CH = "11111111-1111-4111-8111-111111111111";
const PHONE = "+201000000001";
const keyring = parseKeyring(
  JSON.stringify({ current: "k2", keys: { k2: randomBytes(32).toString("base64"), k1: randomBytes(32).toString("base64") } }),
);

type Responder = unknown | ((args: Record<string, unknown>) => { data: unknown; error: null });

function harness(responses: Record<string, Responder>, opts: { enabled?: boolean; failTransport?: boolean } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db: PhoneVerificationDb = {
    async rpc(fn, args) {
      calls.push({ fn, args });
      const r = responses[fn];
      return typeof r === "function" ? (r as (a: Record<string, unknown>) => { data: unknown; error: null })(args) : { data: r ?? null, error: null };
    },
  };
  const fake = createFakeTransport(opts.failTransport ? { failWith: new Error(`upstream rejected ${PHONE}`) } : {});
  const service = createPhoneVerificationService({ db, transport: fake.transport, keyring, enabled: opts.enabled ?? true });
  return { service, calls, fake };
}

const created = (args: Record<string, unknown>) => ({
  data: {
    status: "challenge_created",
    challenge_id: args.p_challenge_id,
    expires_at: "2026-10-30T10:05:00Z",
    resend_available_at: "2026-10-30T10:01:00Z",
    phone_e164: PHONE,
  },
  error: null,
});

describe("feature flag", () => {
  it("OFF: no generation, no database call, no delivery", async () => {
    const { service, calls, fake } = harness({}, { enabled: false });
    expect(await service.start(USER, "203.0.113.9")).toEqual({ status: "unavailable" });
    expect(await service.verify(USER, CH, "123456", null)).toEqual({ status: "unavailable" });
    expect(calls).toHaveLength(0);
    expect(fake.sent).toHaveLength(0);
  });
  it("the default transport refuses to send", async () => {
    await expect(disabledTransport.send({ to: PHONE, code: "000000", ttlSeconds: 300 })).rejects.toThrow("disabled");
  });
});

describe("start", () => {
  it("delivers the code to the adapter only; the database receives a MAC, never the code or the address", async () => {
    const { service, calls, fake } = harness({ phone_verification_start: created });
    const out = await service.start(USER, "203.0.113.9");
    expect(out.status).toBe("sent");
    expect(fake.sent).toHaveLength(1);
    const { code, to } = fake.sent[0]!;
    expect(to).toBe(PHONE);
    expect(code).toMatch(/^[0-9]{6}$/);
    const args = calls[0]!.args;
    expect(args.p_code_mac).toMatch(/^[0-9a-f]{64}$/);
    expect(args.p_kid).toBe("k2");
    expect(args.p_ip_key).toMatch(/^[0-9a-f]{64}$/);
    const wire = JSON.stringify(calls);
    expect(wire).not.toContain(code);
    expect(wire).not.toContain("203.0.113.9");
    // The browser never learns the destination number or the code.
    expect(JSON.stringify(out)).not.toContain(PHONE);
    expect(JSON.stringify(out)).not.toContain(code);
  });

  it.each([
    [{ status: "already_verified" }, { status: "already_verified" }],
    [{ status: "rate_limited", retry_after_seconds: 42 }, { status: "rate_limited", retryAfterSeconds: 42 }],
    [{ status: "unavailable" }, { status: "unavailable" }],
    [{ status: "something_new" }, { status: "unavailable" }],
    [null, { status: "unavailable" }],
  ])("maps %j -> %j and never sends", async (dbAnswer, expected) => {
    const { service, fake } = harness({ phone_verification_start: dbAnswer });
    expect(await service.start(USER, null)).toEqual(expected);
    expect(fake.sent).toHaveLength(0);
  });

  it("a delivery failure closes the challenge and leaks nothing about the transport", async () => {
    const { service, calls } = harness({ phone_verification_start: created }, { failTransport: true });
    const out = await service.start(USER, null);
    expect(out).toEqual({ status: "unavailable" });
    expect(calls.map((c) => c.fn)).toEqual(["phone_verification_start", "phone_verification_invalidate"]);
    expect(calls[1]!.args).toMatchObject({ p_user_id: USER, p_reason: "delivery_failed" });
    expect(JSON.stringify(out)).not.toContain(PHONE);
  });
});

describe("verify", () => {
  it("offers a MAC for every accepted key, consistent with the MAC issued at start", async () => {
    let issued = "";
    const { service, calls, fake } = harness({
      phone_verification_start: (a: Record<string, unknown>) => {
        issued = String(a.p_code_mac);
        return created(a);
      },
      phone_verification_verify: { status: "verified" },
    });
    const started = await service.start(USER, null);
    if (started.status !== "sent") throw new Error("setup failed");
    expect(await service.verify(USER, started.challengeId, fake.sent[0]!.code, null)).toEqual({ status: "verified" });
    const candidates = calls[1]!.args.p_candidates as Record<string, string>;
    expect(Object.keys(candidates).sort()).toEqual(["k1", "k2"]);
    expect(candidates.k2).toBe(issued);
    expect(JSON.stringify(calls[1]!)).not.toContain(fake.sent[0]!.code);
  });

  it("collapses every failure into one generic 'invalid'", async () => {
    for (const answer of [{ status: "invalid" }, { status: "expired" }, { status: "wrong_account" }, { status: "claim_changed" }, {}]) {
      const { service } = harness({ phone_verification_verify: answer });
      expect(await service.verify(USER, CH, "123456", null)).toEqual({ status: "invalid" });
    }
  });

  it("passes rate limiting through and treats database errors as unavailable", async () => {
    const limited = harness({ phone_verification_verify: { status: "rate_limited", retry_after_seconds: 900 } });
    expect(await limited.service.verify(USER, CH, "123456", null)).toEqual({ status: "rate_limited", retryAfterSeconds: 900 });
    const failing = createPhoneVerificationService({
      db: { rpc: async () => ({ data: null, error: { code: "XX000" } }) },
      transport: createFakeTransport().transport,
      keyring,
      enabled: true,
    });
    expect(await failing.verify(USER, CH, "123456", null)).toEqual({ status: "unavailable" });
  });

  it.each(["", "12345", "1234567", "12345a", " 123456", "٠١٢٣٤٥"])("a malformed code %j is invalid without a database call", async (code) => {
    const { service, calls } = harness({ phone_verification_verify: { status: "verified" } });
    expect(await service.verify(USER, CH, code, null)).toEqual({ status: "invalid" });
    expect(await service.verify(USER, "not-a-uuid", "123456", null)).toEqual({ status: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("the verify wire shape never contains the code or the client address", async () => {
    const { service, calls } = harness({ phone_verification_verify: { status: "invalid" } });
    await service.verify(USER, CH, "424242", "198.51.100.7");
    const wire = JSON.stringify(calls);
    expect(wire).not.toContain("424242");
    expect(wire).not.toContain("198.51.100.7");
  });
});
