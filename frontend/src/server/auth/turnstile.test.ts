import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CLOUDFLARE_TEST_SECRET_ALWAYS_PASS,
  TURNSTILE_SITEVERIFY_URL,
  clientIpFrom,
  turnstileHostnamesFrom,
  verifyTurnstileToken,
} from "./turnstile";

const EXPECT = { expectedAction: "phone-sign-up", expectedHostnames: ["app.example.test"] } as const;
/** A genuine-looking Siteverify success for THIS deployment and form. */
const genuine = (extra: Record<string, unknown> = {}) => ({
  success: true,
  hostname: "app.example.test",
  action: "phone-sign-up",
  ...extra,
});

function reply(body: unknown, status = 200) {
  return vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status }));
}
function sentBody(fetchImpl: ReturnType<typeof vi.fn>) {
  return new URLSearchParams(String((fetchImpl.mock.calls[0]![1] as RequestInit).body));
}
function stubLocalEnv(appEnv: string) {
  vi.stubEnv("NEXT_PUBLIC_APP_ENV", appEnv);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
}

describe("verifyTurnstileToken — Cloudflare Siteverify, fail closed", () => {
  beforeEach(() => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "real-secret");
    stubLocalEnv("production");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([undefined, null, 42, "", "   "])("treats %p as a missing token without calling Cloudflare", async (token) => {
    const fetchImpl = reply(genuine());
    expect(await verifyTurnstileToken(token, { fetchImpl, ...EXPECT })).toEqual({ ok: false, reason: "missing" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an oversized token without calling Cloudflare", async () => {
    const fetchImpl = reply(genuine());
    expect(await verifyTurnstileToken("x".repeat(2049), { fetchImpl, ...EXPECT })).toEqual({ ok: false, reason: "rejected" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("passes only on success:true for THIS hostname and action, POSTing secret + response form-encoded", async () => {
    const fetchImpl = reply(genuine());
    expect(await verifyTurnstileToken("tok", { fetchImpl, remoteIp: "203.0.113.7", ...EXPECT })).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(TURNSTILE_SITEVERIFY_URL);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = sentBody(fetchImpl);
    expect(body.get("secret")).toBe("real-secret");
    expect(body.get("response")).toBe("tok");
    expect(body.get("remoteip")).toBe("203.0.113.7");
  });

  it("matches the hostname case-insensitively", async () => {
    expect(await verifyTurnstileToken("tok", { fetchImpl: reply(genuine({ hostname: "APP.Example.TEST" })), ...EXPECT })).toEqual({ ok: true });
  });

  it("omits remoteip when it is not a valid IP", async () => {
    const fetchImpl = reply(genuine());
    await verifyTurnstileToken("tok", { fetchImpl, remoteIp: "not-an-ip, 1.2.3.4", ...EXPECT });
    expect(sentBody(fetchImpl).has("remoteip")).toBe(false);
  });

  it.each([
    ["success:false", { success: false, "error-codes": ["invalid-input-response"] }],
    ["expired or replayed (single-use)", { success: false, "error-codes": ["timeout-or-duplicate"] }],
    ["success as a string", { success: "true" }],
    ["no success field", { hostname: "app.example.test", action: "phone-sign-up" }],
    ["a JSON array", [true]],
    ["JSON null", null],
  ])("rejects %s", async (_label, body) => {
    expect(await verifyTurnstileToken("tok", { fetchImpl: reply(body), ...EXPECT })).toEqual({ ok: false, reason: "rejected" });
  });

  it("calls Siteverify exactly once per verification and never retries, even when Cloudflare is unavailable", async () => {
    const ok = reply(genuine());
    await verifyTurnstileToken("tok", { fetchImpl: ok, ...EXPECT });
    expect(ok).toHaveBeenCalledTimes(1);
    const down = reply(genuine(), 503);
    await verifyTurnstileToken("tok", { fetchImpl: down, ...EXPECT });
    expect(down).toHaveBeenCalledTimes(1);
  });

  it("refuses a replayed token: a stateful single-use Siteverify passes it once, then answers timeout-or-duplicate", async () => {
    const spent = new Set<string>();
    const siteverify = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const token = new URLSearchParams(String(init?.body)).get("response")!;
      const body = spent.has(token) ? { success: false, "error-codes": ["timeout-or-duplicate"] } : genuine();
      spent.add(token);
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const fetchImpl = siteverify as unknown as typeof fetch;
    expect(await verifyTurnstileToken("tok-once", { fetchImpl, ...EXPECT })).toEqual({ ok: true });
    expect(await verifyTurnstileToken("tok-once", { fetchImpl, ...EXPECT })).toEqual({ ok: false, reason: "rejected" });
  });

  it("rejects a real token minted for ANOTHER hostname", async () => {
    expect(await verifyTurnstileToken("tok", { fetchImpl: reply(genuine({ hostname: "evil.example" })), ...EXPECT })).toEqual({
      ok: false,
      reason: "hostname",
    });
  });

  it.each([
    ["missing", undefined],
    ["not a string", 7],
  ])("rejects a response whose hostname is %s", async (_label, hostname) => {
    expect(await verifyTurnstileToken("tok", { fetchImpl: reply(genuine({ hostname })), ...EXPECT })).toEqual({
      ok: false,
      reason: "hostname",
    });
  });

  it("fails closed when no expected hostname is configured", async () => {
    expect(await verifyTurnstileToken("tok", { fetchImpl: reply(genuine()), expectedAction: "phone-sign-up", expectedHostnames: [] })).toEqual({
      ok: false,
      reason: "hostname",
    });
  });

  it("rejects a real token minted for ANOTHER form (action mismatch)", async () => {
    expect(await verifyTurnstileToken("tok", { fetchImpl: reply(genuine({ action: "sign-in" })), ...EXPECT })).toEqual({
      ok: false,
      reason: "action",
    });
  });

  it("rejects a token that carries no action at all", async () => {
    expect(await verifyTurnstileToken("tok", { fetchImpl: reply(genuine({ action: undefined })), ...EXPECT })).toEqual({
      ok: false,
      reason: "action",
    });
  });

  it.each([
    ["a non-2xx status", () => reply(genuine(), 503)],
    ["malformed JSON", () => vi.fn().mockResolvedValue(new Response("<html>oops", { status: 200 }))],
    ["a network error", () => vi.fn().mockRejectedValue(new TypeError("fetch failed"))],
    ["a timeout", () => vi.fn().mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"))],
  ])("fails closed on %s", async (_label, make) => {
    expect(await verifyTurnstileToken("tok", { fetchImpl: make(), ...EXPECT })).toEqual({ ok: false, reason: "unavailable" });
  });

  it("never logs the secret or the token", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m));
    await verifyTurnstileToken("tok-secretive", { fetchImpl: vi.fn().mockRejectedValue(new Error("boom")), ...EXPECT });
    await verifyTurnstileToken("tok-secretive", { fetchImpl: reply({ success: false }), ...EXPECT });
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe("Cloudflare TEST secrets (simulation only — never proof of real-token behavior)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Cloudflare's published test secret answers `hostname: "example.com"`, no action and
  // `metadata.result_with_testing_key: true` (observed against the live Siteverify endpoint).
  const testingKeyAnswer = { success: true, hostname: "example.com", metadata: { result_with_testing_key: true } };

  it("uses the always-pass TEST secret only in local dev when no secret is set, and accepts its answer there", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    stubLocalEnv("local");
    const fetchImpl = reply(testingKeyAnswer);
    expect(await verifyTurnstileToken("tok", { fetchImpl, ...EXPECT })).toEqual({ ok: true });
    expect(sentBody(fetchImpl).get("secret")).toBe(CLOUDFLARE_TEST_SECRET_ALWAYS_PASS);
  });

  it.each(["staging", "production"])("rejects a TEST-key answer in %s even with a real secret configured", async (appEnv) => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "configured-secret");
    stubLocalEnv(appEnv);
    expect(await verifyTurnstileToken("tok", { fetchImpl: reply(testingKeyAnswer), ...EXPECT })).toEqual({
      ok: false,
      reason: "testing_key",
    });
  });

  it.each(["staging", "production"])("fails closed in %s when no secret is set — never calls Cloudflare", async (appEnv) => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    stubLocalEnv(appEnv);
    const fetchImpl = reply(genuine());
    expect(await verifyTurnstileToken("tok", { fetchImpl, ...EXPECT })).toEqual({ ok: false, reason: "unavailable" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("local dev still rejects the test secret's rejected and spent answers", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    stubLocalEnv("local");
    for (const body of [
      { success: false, "error-codes": ["invalid-input-response"] },
      { success: false, "error-codes": ["timeout-or-duplicate"] },
    ]) {
      expect(await verifyTurnstileToken("tok", { fetchImpl: reply(body), ...EXPECT })).toEqual({ ok: false, reason: "rejected" });
    }
  });
});

describe("turnstileHostnamesFrom", () => {
  const headers = (h: Record<string, string>) => (name: string) => h[name] ?? null;
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers x-forwarded-host over host and strips the port", () => {
    expect(turnstileHostnamesFrom(headers({ "x-forwarded-host": "App.Example.test:443", host: "internal:3000" }))).toEqual([
      "app.example.test",
    ]);
  });
  it("falls back to host", () => {
    expect(turnstileHostnamesFrom(headers({ host: "127.0.0.1:3341" }))).toEqual(["127.0.0.1"]);
  });
  it("returns nothing (so verification fails closed) when no host is known", () => {
    expect(turnstileHostnamesFrom(headers({}))).toEqual([]);
  });
  it("lets TURNSTILE_ALLOWED_HOSTNAMES pin the exact hostnames, ignoring the request host", () => {
    vi.stubEnv("TURNSTILE_ALLOWED_HOSTNAMES", "app.example.test, www.example.test");
    expect(turnstileHostnamesFrom(headers({ host: "attacker.example" }))).toEqual(["app.example.test", "www.example.test"]);
  });
});

describe("clientIpFrom", () => {
  const headers = (h: Record<string, string>) => (name: string) => h[name] ?? null;
  it("takes the first x-forwarded-for hop when it is an IP", () => {
    expect(clientIpFrom(headers({ "x-forwarded-for": "198.51.100.4, 10.0.0.1" }))).toBe("198.51.100.4");
  });
  it("falls back to x-real-ip", () => {
    expect(clientIpFrom(headers({ "x-real-ip": "2001:db8::1" }))).toBe("2001:db8::1");
  });
  it("returns null for anything that is not an IP", () => {
    expect(clientIpFrom(headers({ "x-forwarded-for": "evil.example" }))).toBeNull();
    expect(clientIpFrom(headers({}))).toBeNull();
  });
});
