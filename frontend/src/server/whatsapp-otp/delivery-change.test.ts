import { describe, expect, it } from "vitest";
import { applyDelivery, type ApplyOutcome, type DeliveryPayload, type UsageResult, type WorkerUsage } from "./worker-admin";
import { appliedDeliveryRows, changeDelivery, deliveryBlockers, mapDeliveryBeginError, type DeliveryDeps, type DeliveryInput } from "./delivery-change";
import { MANAGE } from "./settings-change";

const ACTOR = "a1000000-0000-4000-8000-000000000001";
const REQ = "b2000000-0000-4000-8000-000000000002";
const GRANT = "A".repeat(43) + "=";

const usageOf = (delivery: { enabled: boolean; version: number } | undefined, blockers: string | null = ""): WorkerUsage =>
  ({
    now: 1, configured: true, settings: null, consumed: 0, accepted: 0, failed: 0, reserved: 0, remaining: 0, effective_limit: 0, percent: 0, level: "ok",
    failure: { last_hour: { attempts: 0, accepted: 0, failed: 0, failure_percent: null }, last_24h: { attempts: 0, accepted: 0, failed: 0, failure_percent: null }, last_7d: { attempts: 0, accepted: 0, failed: 0, failure_percent: null }, last_failure_at: null },
    notifications: { pending: 0, oldest_pending_at: null }, audit: [],
    delivery: delivery && { ...delivery, updated_at: null, updated_by: null },
    delivery_audit: [{ at: 5, request_id: REQ, actor: ACTOR, old: false, new: true, version: 1, reason: "r" }],
    runtime: blockers === null ? {} : { delivery_blockers: blockers },
  }) as WorkerUsage;

function deps(over: Partial<DeliveryDeps> & { usage?: UsageResult } = {}): DeliveryDeps & { calls: string[]; sent: DeliveryPayload[] } {
  const calls: string[] = [];
  const sent: DeliveryPayload[] = [];
  return {
    calls,
    sent,
    fetchUsage: over.fetchUsage ?? (async () => { calls.push("usage"); return over.usage ?? { ok: true, usage: usageOf({ enabled: false, version: 0 }) }; }),
    begin: over.begin ?? (async () => { calls.push("begin"); return { data: { request_id: REQ, reason: "Acceptance window approved", grant: GRANT, grant_expires: 1_800_000_300 }, code: null, message: null }; }),
    apply: over.apply ?? (async (p): Promise<ApplyOutcome> => { calls.push("apply"); sent.push(p); return { kind: "applied", version: p.expected_version + 1 }; }),
    finish: over.finish ?? (async () => { calls.push("finish"); return { data: "applied", code: null, message: null }; }),
  };
}
const input = (over: Partial<DeliveryInput> = {}): DeliveryInput => ({ actorId: ACTOR, permissions: [MANAGE], formVersion: 0, enable: true, reason: "Acceptance window approved", ...over });

describe("changeDelivery: the security order", () => {
  it("applies in order usage -> begin -> apply -> finish and sends the grant, actor and reason exactly as the database returned them", async () => {
    const d = deps();
    expect(await changeDelivery(d, input())).toEqual({ ok: true, code: "whatsappOtp.delivery.doneOn" });
    expect(d.calls).toEqual(["usage", "begin", "apply", "finish"]);
    expect(d.sent[0]).toEqual({ request_id: REQ, actor_id: ACTOR, expected_version: 0, enabled: true, reason: "Acceptance window approved", grant: GRANT, grant_expires: 1_800_000_300 });
  });
  it("turning OFF answers doneOff and passes the OLD state to begin (null only before the first change)", async () => {
    let seen: unknown;
    const d = deps({ usage: { ok: true, usage: usageOf({ enabled: true, version: 2 }) }, begin: async (a) => { seen = a; return { data: { request_id: REQ, reason: "Window closed for today", grant: GRANT, grant_expires: 1 }, code: null, message: null }; } });
    expect(await changeDelivery(d, input({ formVersion: 2, enable: false, reason: "Window closed for today" }))).toEqual({ ok: true, code: "whatsappOtp.delivery.doneOff" });
    expect(seen).toMatchObject({ expectedVersion: 2, old: true, next: false });
    let first: unknown;
    await changeDelivery(deps({ begin: async (a) => { first = a; return { data: null, code: "42501", message: "x" }; } }), input());
    expect(first).toMatchObject({ expectedVersion: 0, old: null, next: true });
  });
  it("Administrator (view only) and anyone without manage is refused before anything is read", async () => {
    const d = deps();
    expect(await changeDelivery(d, input({ permissions: ["whatsapp_otp.view"] }))).toEqual({ ok: false, code: "whatsappOtp.errors.forbidden" });
    expect(d.calls).toEqual([]);
  });
  it("requires a reason of at least 10 characters before reading anything; invalid versions are refused", async () => {
    const d = deps();
    expect(await changeDelivery(d, input({ reason: "  too short " }))).toEqual({ ok: false, code: "whatsappOtp.errors.reasonRequired" });
    expect(await changeDelivery(d, input({ formVersion: Number.NaN }))).toEqual({ ok: false, code: "whatsappOtp.errors.invalid" });
    expect(d.calls).toEqual([]);
  });
  it("refuses a stale version, an unreadable Worker, a Worker without the switch, and a no-op, before begin", async () => {
    const stale = deps();
    expect(await changeDelivery(stale, input({ formVersion: 3 }))).toEqual({ ok: false, code: "whatsappOtp.errors.stale" });
    expect(stale.calls).toEqual(["usage"]);
    expect(await changeDelivery(deps({ usage: { ok: false, code: "unavailable" } }), input())).toEqual({ ok: false, code: "whatsappOtp.errors.unavailable" });
    expect(await changeDelivery(deps({ usage: { ok: true, usage: usageOf(undefined) } }), input())).toEqual({ ok: false, code: "whatsappOtp.errors.unavailable" });
    const same = deps({ usage: { ok: true, usage: usageOf({ enabled: true, version: 1 }) } });
    expect(await changeDelivery(same, input({ formVersion: 1, enable: true }))).toEqual({ ok: false, code: "whatsappOtp.errors.deliveryNoChange" });
    expect(same.calls).toEqual(["usage"]);
  });
  it("turning ON is refused while the Worker reports any blocker (or does not report them); turning OFF never is", async () => {
    const blocked = deps({ usage: { ok: true, usage: usageOf({ enabled: false, version: 0 }, "settings_not_initialized,notify_not_configured") } });
    expect(await changeDelivery(blocked, input())).toEqual({ ok: false, code: "whatsappOtp.errors.deliveryPrerequisites" });
    expect(blocked.calls).toEqual(["usage"]);
    const outdated = deps({ usage: { ok: true, usage: usageOf({ enabled: false, version: 0 }, null) } });
    expect(await changeDelivery(outdated, input())).toEqual({ ok: false, code: "whatsappOtp.errors.deliveryPrerequisites" });
    const off = deps({ usage: { ok: true, usage: usageOf({ enabled: true, version: 4 }, "notify_not_configured") } });
    expect(await changeDelivery(off, input({ formVersion: 4, enable: false }))).toEqual({ ok: true, code: "whatsappOtp.delivery.doneOff" });
  });
  it("the database refusal decides: no permission, no grant key, bad reason, stale", async () => {
    const run = async (code: string | null, message: string) => changeDelivery(deps({ begin: async () => ({ data: null, code, message }) }), input());
    expect(await run("42501", "admin permission whatsapp_otp.manage required")).toEqual({ ok: false, code: "whatsappOtp.errors.forbidden" });
    expect(await run("55000", "whatsapp_otp: grant_key_unconfigured")).toEqual({ ok: false, code: "whatsappOtp.errors.unavailable" });
    expect(await run("22023", "whatsapp_otp: reason_required")).toEqual({ ok: false, code: "whatsappOtp.errors.reasonRequired" });
    expect(await run("22023", "whatsapp_otp: invalid_version")).toEqual({ ok: false, code: "whatsappOtp.errors.stale" });
    expect(await run("XX000", "boom")).toEqual({ ok: false, code: "whatsappOtp.errors.generic" });
    expect(mapDeliveryBeginError("22023", "whatsapp_otp: no_change")).toBe("deliveryNoChange");
  });
  it("a definite Worker refusal is recorded as failed and shown; an AMBIGUOUS answer is pending and never reported as failed", async () => {
    const refused = deps({ apply: async () => ({ kind: "refused", code: "prerequisites_missing", missing: "meta_token_missing" }) });
    expect(await changeDelivery(refused, input())).toEqual({ ok: false, code: "whatsappOtp.errors.deliveryPrerequisites" });
    const finishCalls: unknown[] = [];
    const rec = deps({ apply: async () => ({ kind: "refused", code: "stale_version" }), finish: async (a) => { finishCalls.push(a); return { data: "failed", code: null, message: null }; } });
    expect(await changeDelivery(rec, input())).toEqual({ ok: false, code: "whatsappOtp.errors.stale" });
    expect(finishCalls).toEqual([{ actor: ACTOR, request: REQ, status: "failed", code: "stale_version" }]);
    const amb = deps({ apply: async () => ({ kind: "ambiguous" }) });
    expect(await changeDelivery(amb, input())).toEqual({ ok: true, code: "whatsappOtp.delivery.pending" });
    expect(amb.calls).not.toContain("finish");
  });
  it("a failing completion write never turns an applied change into a failure (reconcile settles it)", async () => {
    const d = deps({ finish: async () => { throw new Error("db down"); } });
    expect(await changeDelivery(d, input())).toEqual({ ok: true, code: "whatsappOtp.delivery.doneOn" });
  });
});

describe("helpers", () => {
  it("deliveryBlockers parses the Worker's comma list and treats a missing field as outdated", () => {
    expect(deliveryBlockers(usageOf({ enabled: false, version: 0 }, ""))).toEqual([]);
    expect(deliveryBlockers(usageOf({ enabled: false, version: 0 }, "a_b,d1_c"))).toEqual(["a_b", "d1_c"]);
    expect(deliveryBlockers(usageOf({ enabled: false, version: 0 }, null))).toEqual(["worker_outdated"]);
    expect(deliveryBlockers(usageOf({ enabled: false, version: 0 }, "ok,<script>"))).toEqual(["ok"]);
  });
  it("appliedDeliveryRows hands reconcile only the fields it needs", () => {
    expect(appliedDeliveryRows(usageOf({ enabled: true, version: 1 }))).toEqual([{ request_id: REQ, actor: ACTOR, version: 1, at: 5, new: true }]);
  });
});

describe("applyDelivery client", () => {
  const config = { workerUrl: "https://w.example.workers.dev/v1/otp/send", adminSecret: "whsec_" + Buffer.alloc(32, 7).toString("base64") };
  const payload: DeliveryPayload = { request_id: REQ, actor_id: ACTOR, expected_version: 0, enabled: true, reason: "Acceptance window approved", grant: GRANT, grant_expires: 1 };
  const respond = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it("posts to /v1/admin/delivery signed with the admin secret", async () => {
    let seen = "";
    const fetchImpl = (async (url: string) => { seen = url; return new Response(JSON.stringify({ status: "applied", version: 1 }), { status: 200 }); }) as unknown as typeof fetch;
    expect(await applyDelivery({ ...config, fetchImpl }, payload)).toEqual({ kind: "applied", version: 1 });
    expect(seen).toBe("https://w.example.workers.dev/v1/admin/delivery");
  });
  it("a 4xx with a code is a definite refusal (with the missing list); a 5xx or garbage is ambiguous", async () => {
    expect(await applyDelivery({ ...config, fetchImpl: respond(422, { error: "prerequisites_missing", missing: "meta_token_missing,d1_unreachable" }) }, payload)).toEqual({ kind: "refused", code: "prerequisites_missing", currentVersion: undefined, missing: "meta_token_missing,d1_unreachable" });
    expect(await applyDelivery({ ...config, fetchImpl: respond(409, { error: "stale_version", current_version: 2 }) }, payload)).toMatchObject({ kind: "refused", code: "stale_version", currentVersion: 2 });
    expect(await applyDelivery({ ...config, fetchImpl: respond(503, { error: "storage_unavailable" }) }, payload)).toEqual({ kind: "ambiguous" });
    expect(await applyDelivery({ ...config, fetchImpl: (async () => { throw new Error("net"); }) as unknown as typeof fetch }, payload)).toEqual({ kind: "ambiguous" });
    expect(await applyDelivery({ workerUrl: undefined, adminSecret: undefined }, payload)).toEqual({ kind: "refused", code: "admin_unconfigured" });
  });
});
