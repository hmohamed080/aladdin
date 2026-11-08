import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { UsageResult, WorkerUsage } from "@/server/whatsapp-otp/worker-admin";
import { createDeliveryGate, usageAllowsDelivery } from "./delivery-gate";
import { parseKeyring } from "./otp";
import type { PhoneVerificationDb } from "./service";
import { createPhoneSignupService } from "./signup-service";
import { createFakeTransport } from "./transport";

const REG = "33333333-3333-4333-8333-333333333333";
const PHONE = "+201000000077";
const keyring = parseKeyring(JSON.stringify({ current: "k2", keys: { k2: randomBytes(32).toString("base64") } }));

function usage(over: Partial<WorkerUsage> & { delivery_enabled?: boolean | undefined } = {}): UsageResult {
  const { delivery_enabled, ...rest } = over;
  const runtime = delivery_enabled === undefined && "delivery_enabled" in over ? {} : { delivery_enabled: delivery_enabled ?? true };
  return { ok: true, usage: { configured: true, level: "ok", remaining: 100, runtime, ...rest } as unknown as WorkerUsage };
}

describe("usageAllowsDelivery", () => {
  const u = (r: UsageResult) => (r.ok ? r.usage : (undefined as never));
  it("is true only when the effective switch is on, budget is configured and not exhausted", () => {
    expect(usageAllowsDelivery(u(usage()))).toBe(true);
    expect(usageAllowsDelivery(u(usage({ delivery_enabled: false })))).toBe(false);
    expect(usageAllowsDelivery(u(usage({ configured: false })))).toBe(false);
    expect(usageAllowsDelivery(u(usage({ level: "exhausted" })))).toBe(false);
    expect(usageAllowsDelivery(u(usage({ remaining: 0 })))).toBe(false);
  });
  it("an older Worker without runtime facts is unavailable", () => {
    expect(usageAllowsDelivery(u(usage({ runtime: undefined })))).toBe(false);
  });
});

describe("delivery gate cache and failure behaviour", () => {
  it("reuses a cached positive answer within the ttl, then probes again", async () => {
    let t = 1000;
    const fetchUsage = vi.fn(async () => usage());
    const gate = createDeliveryGate({ fetchUsage, ttlMs: 5000, now: () => t });
    expect(await gate()).toBe(true);
    t += 4000;
    expect(await gate()).toBe(true);
    expect(fetchUsage).toHaveBeenCalledTimes(1);
    t += 2000;
    await gate();
    expect(fetchUsage).toHaveBeenCalledTimes(2);
  });

  it("two concurrent callers each run their OWN probe; neither depends on the other's promise", async () => {
    const releases: ((r: UsageResult) => void)[] = [];
    const fetchUsage = vi.fn(() => new Promise<UsageResult>((resolve) => { releases.push(resolve); }));
    const gate = createDeliveryGate({ fetchUsage, timeoutMs: 1000 });
    const a = gate();
    const b = gate();
    expect(fetchUsage).toHaveBeenCalledTimes(2);
    releases[1]!(usage({ delivery_enabled: false }));
    expect(await b).toBe(false);
    releases[0]!(usage());
    expect(await a).toBe(true);
  });

  it("a switch turned OFF is seen after the ttl", async () => {
    let t = 0;
    let on = true;
    const gate = createDeliveryGate({ fetchUsage: async () => usage({ delivery_enabled: on }), ttlMs: 5000, now: () => t });
    expect(await gate()).toBe(true);
    on = false;
    t += 5001;
    expect(await gate()).toBe(false);
  });

  it("an error, a refusal and a hang all answer false (fail closed)", async () => {
    expect(await createDeliveryGate({ fetchUsage: async (): Promise<UsageResult> => { throw new Error("boom"); } })()).toBe(false);
    expect(await createDeliveryGate({ fetchUsage: async () => ({ ok: false, code: "unavailable" }) })()).toBe(false);
    expect(await createDeliveryGate({ fetchUsage: async () => ({ ok: false, code: "unconfigured" }) })()).toBe(false);
    expect(await createDeliveryGate({ fetchUsage: () => new Promise<UsageResult>(() => undefined), timeoutMs: 20 })()).toBe(false);
  });

  it("a failed or timed-out probe does not poison the cache: the next call recovers at once", async () => {
    let mode: "fail" | "hang" | "ok" = "fail";
    const fetchUsage = vi.fn((): Promise<UsageResult> => {
      if (mode === "fail") return Promise.reject(new Error("down"));
      if (mode === "hang") return new Promise<UsageResult>(() => undefined);
      return Promise.resolve(usage());
    });
    const gate = createDeliveryGate({ fetchUsage, ttlMs: 60_000, timeoutMs: 20, now: () => 0 });
    expect(await gate()).toBe(false);
    mode = "hang";
    expect(await gate()).toBe(false);
    mode = "ok";
    expect(await gate()).toBe(true);
    expect(fetchUsage).toHaveBeenCalledTimes(3);
  });
});

describe("signup service with the delivery gate", () => {
  function harness(deliveryAvailable: () => Promise<boolean>, deliver = true) {
    const tasks: Promise<void>[] = [];
    const rpc = vi.fn(async (_fn: string, args: Record<string, unknown>) => ({
      data: { status: "challenge_created", challenge_id: args.p_challenge_id, expires_at: "2026-10-30T10:05:00Z", resend_available_at: "2026-10-30T10:01:00Z", deliver },
      error: null,
    }));
    const db = { rpc } as unknown as PhoneVerificationDb;
    const fake = createFakeTransport({});
    const service = createPhoneSignupService({ db, transport: fake.transport, keyring, enabled: true, defer: (t) => { tasks.push(t); }, deliveryAvailable });
    return { service, rpc, fake, flush: async () => { await Promise.all(tasks.splice(0)); } };
  }

  it("available: proceeds as before", async () => {
    const h = harness(async () => true);
    expect((await h.service.start(REG, PHONE, null)).status).toBe("sent");
    await h.flush();
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.fake.sent).toHaveLength(1);
  });

  it("unavailable: UNAVAILABLE, no phone_signup_start RPC and nothing sent", async () => {
    const h = harness(async () => false);
    expect(await h.service.start(REG, PHONE, null)).toEqual({ status: "unavailable" });
    await h.flush();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.fake.sent).toHaveLength(0);
  });

  it("the status check throwing is UNAVAILABLE", async () => {
    const h = harness(async () => { throw new Error("worker down"); });
    expect(await h.service.start(REG, PHONE, null)).toEqual({ status: "unavailable" });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("the gate never receives the number, and a registered and a free number get the identical reply", async () => {
    const seen: unknown[][] = [];
    const gate = async (...args: unknown[]) => { seen.push(args); return true; };
    const taken = harness(gate, false);
    const free = harness(gate, true);
    const a = await taken.service.start(REG, PHONE, null);
    const b = await free.service.start(REG, PHONE, null);
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    expect(a.status).toBe("sent");
    expect(seen.every((args) => args.length === 0)).toBe(true);
    const down = harness(async () => false);
    expect(await down.service.start(REG, PHONE, null)).toEqual(await down.service.start(REG, "+201111111111", null));
  });
});
