import { describe, expect, it, vi } from "vitest";
import { signPayload, verifySignature } from "../../../../edge/whatsapp-otp-worker/src/signing";
import { signBody, verifyBody } from "./signing";
import { adminBase, applySettings, fetchUsage, parseUsage, probeNotify, type ApplyOutcome, type UsageResult, type WorkerUsage } from "./worker-admin";
import { CEILING_MANAGE, MANAGE, appliedRows, changeSettings, mapBeginError, type ChangeDeps, type ChangeInput } from "./settings-change";
import { expectedSourceEnvFor, handleNotify, parseNotifyBody } from "./notify";
import { chooseWorkerTransport } from "./worker-binding";
import { ADMIN_ROUTE_RULES, canAccessAdminPath, parseAdminAccess } from "@/lib/permissions/admin";
import { parsePhoneVerificationEnv } from "@/lib/env/phone-verification";

const SECRET = "whsec_" + Buffer.alloc(32, 7).toString("base64");
const OTHER = "whsec_" + Buffer.alloc(32, 9).toString("base64");
const ACTOR = "a1000000-0000-4000-8000-000000000001";
const REQ = "b2000000-0000-4000-8000-000000000002";
const NOW = 1_800_000_000_000;
const GRANT = "A".repeat(43) + "=";

const settings = { daily_limit: 150, hard_ceiling: 5000, warn_percent: 70, critical_percent: 90, version: 3, updated_at: 1, updated_by: ACTOR };
const usageOf = (s: typeof settings | null): WorkerUsage =>
  ({
    now: 1, configured: s !== null, settings: s, consumed: 10, accepted: 9, failed: 1, reserved: 0, remaining: 140, effective_limit: 150, percent: 7, level: "ok",
    failure: { last_hour: { attempts: 0, accepted: 0, failed: 0, failure_percent: null }, last_24h: { attempts: 10, accepted: 9, failed: 1, failure_percent: 10 }, last_7d: { attempts: 10, accepted: 9, failed: 1, failure_percent: 10 }, last_failure_at: null },
    notifications: { pending: 0, oldest_pending_at: null },
    audit: [{ at: 1, request_id: REQ, actor: ACTOR, kind: "update", version: 3, reason: "r", old: null, new: settings }],
  }) as WorkerUsage;

describe("signing: byte-compatible with the Worker, and strict", () => {
  it("a body signed here verifies in the Worker, and the reverse", async () => {
    const body = JSON.stringify({ a: 1 });
    const sig = signBody(SECRET, "adm_x", NOW / 1000, body)!;
    const h = new Headers({ "webhook-id": "adm_x", "webhook-timestamp": String(NOW / 1000), "webhook-signature": sig });
    expect(await verifySignature(body, h, SECRET, NOW)).toBe(true);
    const wsig = (await signPayload(SECRET, "ntf_k", NOW / 1000, body))!;
    expect(verifyBody(SECRET, body, new Headers({ "webhook-id": "ntf_k", "webhook-timestamp": String(NOW / 1000), "webhook-signature": wsig }), NOW)).toBe(true);
  });
  it("refuses a tampered body, a wrong secret, a stale or future timestamp and a missing header", () => {
    const body = "{}";
    const mk = (b: string, stamp: number, secret = SECRET) => ({ b, h: new Headers({ "webhook-id": "i", "webhook-timestamp": String(stamp), "webhook-signature": signBody(secret, "i", stamp, "{}")! }) });
    const ok = mk(body, NOW / 1000);
    expect(verifyBody(SECRET, ok.b, ok.h, NOW)).toBe(true);
    expect(verifyBody(SECRET, '{"x":1}', ok.h, NOW)).toBe(false);
    expect(verifyBody(OTHER, ok.b, ok.h, NOW)).toBe(false);
    expect(verifyBody(SECRET, ok.b, ok.h, NOW + 301_000)).toBe(false);
    expect(verifyBody(SECRET, ok.b, ok.h, NOW - 301_000)).toBe(false);
    expect(verifyBody(SECRET, ok.b, new Headers(), NOW)).toBe(false);
    expect(signBody("not-a-secret", "i", 1, "{}")).toBeNull();
    expect(signBody(SECRET, "has.dot", 1, "{}")).toBeNull();
  });
});

describe("worker admin client", () => {
  it("derives the admin base from the send URL origin and refuses plain http outside loopback", () => {
    expect(adminBase("https://w.example.workers.dev/v1/otp/send")?.origin).toBe("https://w.example.workers.dev");
    expect(adminBase("http://127.0.0.1:8787/v1/otp/send")?.origin).toBe("http://127.0.0.1:8787");
    expect(adminBase("http://evil.example/v1/otp/send")).toBeNull();
    expect(adminBase(undefined)).toBeNull();
    expect(adminBase("not a url")).toBeNull();
  });
  it("signs with the ADMIN secret only: the send secret cannot open the admin door", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify(usageOf(settings)), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await fetchUsage({ workerUrl: "https://w.example.workers.dev/v1/otp/send", adminSecret: SECRET, fetchImpl, now: () => NOW });
    expect(r.ok).toBe(true);
    const s = seen as unknown as { url: string; init: RequestInit };
    expect(s.url).toBe("https://w.example.workers.dev/v1/admin/usage");
    const h = new Headers(s.init.headers);
    expect(h.get("webhook-id")).toMatch(/^adm_[0-9a-f-]{36}$/);
    expect(await verifySignature(String(s.init.body), h, SECRET, NOW)).toBe(true);
    expect(await verifySignature(String(s.init.body), h, OTHER, NOW)).toBe(false);
  });
  it("reports unconfigured without a secret and unavailable on a network failure or a malformed answer", async () => {
    expect(await fetchUsage({ workerUrl: "https://w.example/v1/otp/send", adminSecret: undefined })).toEqual({ ok: false, code: "unconfigured" });
    const boom = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
    expect(await fetchUsage({ workerUrl: "https://w.example/v1/otp/send", adminSecret: SECRET, fetchImpl: boom })).toEqual({ ok: false, code: "unavailable" });
    const junk = (async () => new Response("{\"configured\":\"yes\"}", { status: 200 })) as unknown as typeof fetch;
    expect(await fetchUsage({ workerUrl: "https://w.example/v1/otp/send", adminSecret: SECRET, fetchImpl: junk })).toEqual({ ok: false, code: "unavailable" });
    expect(parseUsage(null)).toBeNull();
  });
  it("maps the Worker answer: applied, a definite 4xx refusal, and everything else as AMBIGUOUS (never 'failed')", async () => {
    const payload = { request_id: REQ, actor_id: ACTOR, expected_version: 3, daily_limit: 200, hard_ceiling: 5000, warn_percent: 70, critical_percent: 90, reason: "because of reasons", ceiling_authorized: false, grant: GRANT, grant_expires: 1_800_000_300 };
    const call = (res: () => Promise<Response>) => applySettings({ workerUrl: "https://w.example/v1/otp/send", adminSecret: SECRET, fetchImpl: res as unknown as typeof fetch }, payload);
    expect(await call(async () => new Response(JSON.stringify({ status: "applied", version: 4 }), { status: 200 }))).toEqual({ kind: "applied", version: 4 });
    expect(await call(async () => new Response(JSON.stringify({ error: "stale_version", current_version: 5 }), { status: 409 }))).toEqual({ kind: "refused", code: "stale_version", currentVersion: 5 });
    expect(await call(async () => new Response("{}", { status: 503 }))).toEqual({ kind: "ambiguous" });
    expect(await call(async () => new Response("not json", { status: 200 }))).toEqual({ kind: "ambiguous" });
    expect(await call(async () => { throw new Error("timeout"); })).toEqual({ kind: "ambiguous" });
    expect(await call(async () => new Response(JSON.stringify({ error: "<script>" }), { status: 422 }))).toEqual({ kind: "ambiguous" });
  });
});

function deps(over: Partial<ChangeDeps> = {}): ChangeDeps & { calls: string[] } {
  const calls: string[] = [];
  const base: ChangeDeps = {
    fetchUsage: async () => { calls.push("usage"); return { ok: true, usage: usageOf(settings) } as UsageResult; },
    begin: async () => { calls.push("begin"); return { data: { request_id: REQ, ceiling_changed: false, reason: "raising for a launch week", grant: GRANT, grant_expires: 1_800_000_300 }, code: null, message: null }; },
    apply: async () => { calls.push("apply"); return { kind: "applied", version: 4 } as ApplyOutcome; },
    finish: async () => { calls.push("finish"); return { data: "applied", code: null, message: null }; },
  };
  return Object.assign({ ...base, ...over }, { calls });
}
const input = (over: Partial<ChangeInput> = {}): ChangeInput => ({
  actorId: ACTOR, permissions: [MANAGE, CEILING_MANAGE], formVersion: 3, dailyLimit: 200, hardCeiling: 5000, warnPercent: 70, criticalPercent: 90,
  reason: "raising for a launch week", ceilingConfirmation: "", ...over,
});

describe("changeSettings: the security order", () => {
  it("applies a change in order usage -> begin -> apply -> finish", async () => {
    const d = deps();
    expect(await changeSettings(d, input())).toEqual({ ok: true, code: "whatsappOtp.form.done" });
    expect(d.calls).toEqual(["usage", "begin", "apply", "finish"]);
  });
  it("refuses a caller without manage before touching anything (Administrator is view-only)", async () => {
    const d = deps();
    expect(await changeSettings(d, input({ permissions: ["whatsapp_otp.view"] }))).toEqual({ ok: false, code: "whatsappOtp.errors.forbidden" });
    expect(d.calls).toEqual([]);
  });
  it("refuses a ceiling change without ceiling_manage, and one without the typed confirmation, before begin", async () => {
    const d1 = deps();
    expect(await changeSettings(d1, input({ permissions: [MANAGE], hardCeiling: 6000, ceilingConfirmation: "6000" }))).toEqual({ ok: false, code: "whatsappOtp.errors.ceilingForbidden" });
    expect(d1.calls).toEqual(["usage"]);
    const d2 = deps();
    expect(await changeSettings(d2, input({ hardCeiling: 6000, ceilingConfirmation: "5000" }))).toEqual({ ok: false, code: "whatsappOtp.errors.ceilingConfirmation" });
    expect(d2.calls).toEqual(["usage"]);
  });
  it("refuses a stale form version (concurrent change) and an unreadable Worker", async () => {
    const d = deps();
    expect(await changeSettings(d, input({ formVersion: 2 }))).toEqual({ ok: false, code: "whatsappOtp.errors.stale" });
    expect(d.calls).toEqual(["usage"]);
    const down = deps({ fetchUsage: async () => ({ ok: false, code: "unavailable" }) });
    expect(await changeSettings(down, input())).toEqual({ ok: false, code: "whatsappOtp.errors.unavailable" });
  });
  it("rejects non-integer input and never reaches the network", async () => {
    const d = deps();
    expect(await changeSettings(d, input({ dailyLimit: Number.NaN }))).toEqual({ ok: false, code: "whatsappOtp.errors.invalid" });
    expect(await changeSettings(d, input({ dailyLimit: 1.5 }))).toEqual({ ok: false, code: "whatsappOtp.errors.invalid" });
    expect(d.calls).toEqual([]);
  });
  it("sends ceiling_authorized only when the DATABASE confirmed the ceiling change, plus the typed confirmation", async () => {
    let sent: Record<string, unknown> | null = null;
    const d = deps({
      begin: async () => ({ data: { request_id: REQ, ceiling_changed: true, reason: "raising the ceiling for the launch", grant: GRANT, grant_expires: 1_800_000_300 }, code: null, message: null }),
      apply: async (p) => { sent = p as unknown as Record<string, unknown>; return { kind: "applied", version: 4 }; },
    });
    await changeSettings(d, input({ hardCeiling: 6000, ceilingConfirmation: "6000", reason: "raising the ceiling for the launch" }));
    expect(sent).toMatchObject({ ceiling_authorized: true, ceiling_confirmation: "6000", actor_id: ACTOR, expected_version: 3 });
    let plain: Record<string, unknown> | null = null;
    await changeSettings(deps({ apply: async (p) => { plain = p as unknown as Record<string, unknown>; return { kind: "applied", version: 4 }; } }), input());
    expect(plain).toMatchObject({ ceiling_authorized: false });
    expect(plain).not.toHaveProperty("ceiling_confirmation");
  });
  it("never applies when the database refuses (permission, ceiling below limit, reason, invalid)", async () => {
    const refuse = (code: string, message: string) => deps({ begin: async () => ({ data: null, code, message }) });
    for (const [code, message, key] of [
      ["42501", "admin permission whatsapp_otp.manage required", "forbidden"],
      ["42501", "admin permission whatsapp_otp.ceiling_manage required", "ceilingForbidden"],
      ["22023", "whatsapp_otp: ceiling_below_current_limit", "ceilingBelowLimit"],
      ["22023", "whatsapp_otp: reason_required", "reasonRequired"],
      ["22023", "whatsapp_otp: no_change", "noChange"],
      ["22023", "whatsapp_otp: invalid_settings", "invalid"],
      ["XX000", "boom", "generic"],
    ] as const) {
      const d = refuse(code, message);
      expect(await changeSettings(d, input())).toEqual({ ok: false, code: `whatsappOtp.errors.${key}` });
      expect(d.calls).toEqual(["usage"]);
      expect(mapBeginError(code, message)).toBe(key);
    }
  });
  it("records a definite Worker refusal as failed, and leaves an ambiguous answer PENDING (no failed write)", async () => {
    const finish = vi.fn(async () => ({ data: "failed", code: null, message: null }));
    const refused = deps({ apply: async () => ({ kind: "refused", code: "ceiling_not_authorized" }), finish });
    expect(await changeSettings(refused, input())).toEqual({ ok: false, code: "whatsappOtp.errors.ceilingForbidden" });
    expect(finish).toHaveBeenCalledWith({ actor: ACTOR, request: REQ, status: "failed", code: "ceiling_not_authorized" });
    const finish2 = vi.fn(async () => ({ data: "x", code: null, message: null }));
    const ambiguous = deps({ apply: async () => ({ kind: "ambiguous" }), finish: finish2 });
    expect(await changeSettings(ambiguous, input())).toEqual({ ok: true, code: "whatsappOtp.form.pending" });
    expect(finish2).not.toHaveBeenCalled();
  });
  it("still reports success when the completion write fails (reconcile settles it from D1)", async () => {
    const d = deps({ finish: async () => { throw new Error("db down"); } });
    expect(await changeSettings(d, input())).toEqual({ ok: true, code: "whatsappOtp.form.done" });
  });
  it("builds reconcile input only from the Worker's audit rows", () => {
    expect(appliedRows(usageOf(settings))).toEqual([{ request_id: REQ, actor: ACTOR, version: 3, at: 1, new: { daily_limit: 150, hard_ceiling: 5000, warn_percent: 70, critical_percent: 90 } }]);
  });
});

describe("notify callback", () => {
  const body = JSON.stringify({ event_key: "budget_warning:2", kind: "budget_warning", source_env: "production", occurred_at: 1_799_999_000, stats: { limit: 150, consumed: 110, remaining: 40, percent: 73, level: "warning" } });
  const req = (b: string, over: { id?: string; secret?: string; stamp?: number; type?: string; method?: string } = {}) => {
    const id = over.id ?? "ntf_budget_warning:2";
    const stamp = over.stamp ?? NOW / 1000;
    return new Request("https://app.example/api/internal/whatsapp-otp/notify", {
      method: over.method ?? "POST",
      headers: { "content-type": over.type ?? "application/json", "webhook-id": id, "webhook-timestamp": String(stamp), "webhook-signature": signBody(over.secret ?? SECRET, id, stamp, b)! },
      body: over.method === "GET" ? undefined : b,
    });
  };
  const run = (r: Request, record = vi.fn(async () => ({ ok: true })), secret: string | null = SECRET) => handleNotify(r, { secret: secret ?? undefined, expectedSourceEnv: "production", record, now: () => NOW }).then((res) => ({ status: res.status, record }));

  it("records a validly signed alert once and answers 200", async () => {
    const { status, record } = await run(req(body));
    expect(status).toBe(200);
    expect(record).toHaveBeenCalledWith({ eventKey: "budget_warning:2", kind: "budget_warning", sourceEnv: "production", occurredAt: 1_799_999_000, stats: { limit: 150, consumed: 110, remaining: 40, percent: 73, level: "warning" } });
  });
  it("refuses bad signatures, the wrong secret (send/admin keys), stale stamps, wrong method and content type, never calling the database", async () => {
    for (const r of [req(body, { secret: OTHER }), req(body, { stamp: NOW / 1000 - 400 }), req(body, { type: "text/plain" }), req(body, { method: "GET" })]) {
      const { status, record } = await run(r);
      expect([401, 415, 405]).toContain(status);
      expect(record).not.toHaveBeenCalled();
    }
    const tampered = req(body);
    const { status, record } = await run(new Request(tampered.url, { method: "POST", headers: tampered.headers, body: body.replace("110", "1") }));
    expect(status).toBe(401);
    expect(record).not.toHaveBeenCalled();
  });
  it("fails closed without a configured secret and when the signed id is not this event's identity", async () => {
    expect((await run(req(body), undefined, null)).status).toBe(503);
    const relabelled = await run(req(body, { id: "ntf_budget_warning:9" }));
    expect(relabelled.status).toBe(400);
    expect(relabelled.record).not.toHaveBeenCalled();
  });
  it("rejects personal data, codes and unknown fields even when correctly signed", async () => {
    const bad = (extra: Record<string, unknown>, stats: Record<string, unknown> = { limit: 1 }) => JSON.stringify({ ...JSON.parse(body), ...extra, stats });
    for (const b of [
      bad({ phone: "+201000000000" }),
      bad({}, { limit: 1, phone: "+201000000000" }),
      bad({}, { limit: "150; drop table" }),
      bad({ kind: "unknown_kind" }),
      bad({ event_key: "budget_warning:abc" }),
      bad({ source_env: "Production!" }),
      "[]",
      "not json",
    ]) {
      const { status, record } = await run(req(b));
      expect(status, b).toBe(400);
      expect(record).not.toHaveBeenCalled();
    }
    expect(parseNotifyBody(body)).not.toBeNull();
  });
  it("answers 503 so the Worker retries when the database fails, and 200 for a duplicate", async () => {
    expect((await run(req(body), vi.fn(async () => ({ ok: false })))).status).toBe(503);
    expect((await run(req(body), vi.fn(async () => { throw new Error("db"); }))).status).toBe(503);
    expect((await run(req(body), vi.fn(async () => ({ ok: true })))).status).toBe(200);
  });
});

describe("permissions and configuration", () => {
  it("opens the page for view only, and the view permission alone does not include manage", () => {
    expect(ADMIN_ROUTE_RULES["/admin/whatsapp-otp"]).toBe("whatsapp_otp.view");
    const viewer = parseAdminAccess({ rank: 80, permissions: ["whatsapp_otp.view"], roles: [], is_staff: true });
    expect(canAccessAdminPath(viewer, "/admin/whatsapp-otp")).toBe(true);
    const support = parseAdminAccess({ rank: 20, permissions: ["users.read"], roles: [], is_staff: true });
    expect(canAccessAdminPath(support, "/admin/whatsapp-otp")).toBe(false);
    expect(viewer.permissions).not.toContain("whatsapp_otp.manage");
  });
  it("the admin and notify secrets are their own variables with the same strict format", () => {
    const base = { PHONE_OTP_WORKER_SECRET: SECRET, PHONE_OTP_ADMIN_SECRET: OTHER, PHONE_OTP_NOTIFY_SECRET: SECRET };
    const e = parsePhoneVerificationEnv(base);
    expect(e.workerSecret).toBe(SECRET);
    expect(e.adminSecret).toBe(OTHER);
    expect(e.notifySecret).toBe(SECRET);
    expect(() => parsePhoneVerificationEnv({ PHONE_OTP_ADMIN_SECRET: "short" })).toThrow();
    expect(parsePhoneVerificationEnv({}).adminSecret).toBeUndefined();
  });
});

describe("the database grant is carried to the Worker exactly as issued (F-1)", () => {
  it("sends the grant, its expiry and the reason EXACTLY as the database stored it", async () => {
    let sent: Record<string, unknown> | null = null;
    const d = deps({
      begin: async () => ({ data: { request_id: REQ, ceiling_changed: false, reason: "stored by the database", grant: GRANT, grant_expires: 1_800_000_123 }, code: null, message: null }),
      apply: async (p) => { sent = p as unknown as Record<string, unknown>; return { kind: "applied", version: 4 }; },
    });
    await changeSettings(d, input({ reason: "  typed by the admin with spaces  " }));
    expect(sent).toMatchObject({ grant: GRANT, grant_expires: 1_800_000_123, reason: "stored by the database", ceiling_authorized: false });
  });
  it("never reaches the Worker when the database refuses or has no grant key (fail closed)", async () => {
    const d = deps({ begin: async () => ({ data: null, code: "55000", message: "whatsapp_otp: grant_key_unconfigured" }) });
    expect(await changeSettings(d, input())).toEqual({ ok: false, code: "whatsappOtp.errors.unavailable" });
    expect(d.calls).toEqual(["usage"]);
    expect(mapBeginError("55000", "x")).toBe("unavailable");
  });
  it("a Worker answer of grant_invalid is a definite refusal, recorded as failed", async () => {
    const d = deps({ apply: async () => ({ kind: "refused", code: "grant_invalid" }) as ApplyOutcome });
    expect(await changeSettings(d, input())).toEqual({ ok: false, code: "whatsappOtp.errors.generic" });
    expect(d.calls).toEqual(["usage", "begin", "finish"]);
  });
});

describe("notification environment binding (F-4)", () => {
  const stamp = NOW / 1000;
  const mk = (sourceEnv: string) => {
    const b = JSON.stringify({ event_key: "budget_warning:2", kind: "budget_warning", source_env: sourceEnv, occurred_at: 1_799_999_000, stats: { limit: 150, percent: 73 } });
    const id = "ntf_budget_warning:2";
    return new Request("https://app.test/api/internal/whatsapp-otp/notify", { method: "POST", headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": String(stamp), "webhook-signature": signBody(SECRET, id, stamp, b)! }, body: b });
  };
  const run = (r: Request, expectedSourceEnv: string | undefined) => {
    const record = vi.fn(async () => ({ ok: true }));
    return handleNotify(r, { secret: SECRET, expectedSourceEnv, record, now: () => NOW }).then((res) => ({ status: res.status, record }));
  };
  it("maps the app environment to the only Worker environment it trusts", () => {
    expect(expectedSourceEnvFor("production")).toBe("production");
    expect(expectedSourceEnvFor("staging")).toBe("acceptance");
    expect(expectedSourceEnvFor("local")).toBe("local");
    expect(expectedSourceEnvFor("preview")).toBeUndefined();
    expect(expectedSourceEnvFor(undefined)).toBeUndefined();
    expect(expectedSourceEnvFor("__proto__")).toBeUndefined();
  });
  it("a correctly signed, schema-valid alert from the OTHER environment is refused and never recorded", async () => {
    const wrongForProduction = await run(mk("acceptance"), "production");
    expect(wrongForProduction.status).toBe(403);
    expect(wrongForProduction.record).not.toHaveBeenCalled();
    const wrongForAcceptance = await run(mk("production"), "acceptance");
    expect(wrongForAcceptance.status).toBe(403);
    expect(wrongForAcceptance.record).not.toHaveBeenCalled();
    for (const odd of ["local", "worker", "unknown", "prod"]) expect((await run(mk(odd), "production")).status).toBe(403);
  });
  it("the matching environment is accepted, and an app that cannot tell its own environment accepts nothing (503)", async () => {
    const ok = await run(mk("production"), "production");
    expect(ok.status).toBe(200);
    expect(ok.record).toHaveBeenCalledTimes(1);
    const unknown = await run(mk("production"), undefined);
    expect(unknown.status).toBe(503);
    expect(unknown.record).not.toHaveBeenCalled();
  });
});

describe("private Worker transport: a service binding in production, never a public URL (F-2)", () => {
  const binding = { fetch: vi.fn(async () => new Response("{}")) };
  it("uses the binding whenever it exists, in every environment", async () => {
    for (const appEnv of ["production", "staging", "local", undefined]) {
      const t = chooseWorkerTransport({ appEnv, binding });
      expect(t.ok && t.via).toBe("binding");
    }
    const t = chooseWorkerTransport({ appEnv: "production", binding });
    if (t.ok && t.fetchImpl) await t.fetchImpl("https://internal.example/v1/admin/usage", { method: "POST" });
    expect(binding.fetch).toHaveBeenCalledWith("https://internal.example/v1/admin/usage", { method: "POST" });
  });
  it("production, an unknown environment and a missing configuration NEVER fall back to a public URL", () => {
    for (const appEnv of ["production", undefined, "", "prod", "preview", "Production"]) expect(chooseWorkerTransport({ appEnv, binding: undefined })).toEqual({ ok: false });
  });
  it("only an explicit local or staging environment may use the configured URL without a binding", () => {
    expect(chooseWorkerTransport({ appEnv: "local", binding: undefined })).toEqual({ ok: true, via: "public", fetchImpl: undefined });
    expect(chooseWorkerTransport({ appEnv: "staging", binding: undefined })).toEqual({ ok: true, via: "public", fetchImpl: undefined });
  });
});

describe("probeNotify: the Worker-side alert-path check", () => {
  const config = (res: () => Promise<Response>) => ({ workerUrl: "https://w.example/v1/otp/send", adminSecret: SECRET, fetchImpl: res as unknown as typeof fetch });
  it("returns only a known category, signed with the ADMIN secret to the admin path", async () => {
    let seen = "";
    const ok = await probeNotify({ ...config(async () => new Response(JSON.stringify({ result: "reachable", status: 400 }))), fetchImpl: (async (u: string) => { seen = u; return new Response(JSON.stringify({ result: "reachable", status: 400 })); }) as unknown as typeof fetch });
    expect(ok).toEqual({ ok: true, result: "reachable" });
    expect(seen).toBe("https://w.example/v1/admin/notify-check");
  });
  it("treats an unknown value, an HTTP error, a network error and a missing secret as unavailable", async () => {
    expect(await probeNotify(config(async () => new Response(JSON.stringify({ result: "<script>" }))))).toEqual({ ok: false });
    expect(await probeNotify(config(async () => new Response("{}", { status: 503 })))).toEqual({ ok: false });
    expect(await probeNotify(config(async () => { throw new Error("x"); }))).toEqual({ ok: false });
    expect(await probeNotify({ workerUrl: "https://w.example/v1/otp/send", adminSecret: undefined })).toEqual({ ok: false });
  });
});
