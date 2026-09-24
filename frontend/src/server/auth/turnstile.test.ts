import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CLOUDFLARE_TEST_SECRET_ALWAYS_PASS,
  TURNSTILE_SITEVERIFY_URL,
  clientIpFrom,
  verifyTurnstileToken,
} from "./turnstile";

function reply(body: unknown, status = 200) {
  return vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status }));
}
function sentBody(fetchImpl: ReturnType<typeof vi.fn>) {
  return new URLSearchParams(String((fetchImpl.mock.calls[0]![1] as RequestInit).body));
}

describe("verifyTurnstileToken — Cloudflare Siteverify, fail closed", () => {
  beforeEach(() => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "real-secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([undefined, null, 42, "", "   "])("treats %p as a missing token without calling Cloudflare", async (token) => {
    const fetchImpl = reply({ success: true });
    expect(await verifyTurnstileToken(token, { fetchImpl })).toEqual({ ok: false, reason: "missing" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an oversized token without calling Cloudflare", async () => {
    const fetchImpl = reply({ success: true });
    expect(await verifyTurnstileToken("x".repeat(2049), { fetchImpl })).toEqual({ ok: false, reason: "rejected" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("passes only on an explicit success:true, POSTing secret + response form-encoded", async () => {
    const fetchImpl = reply({ success: true, hostname: "example.com" });
    expect(await verifyTurnstileToken("tok", { fetchImpl, remoteIp: "203.0.113.7" })).toEqual({ ok: true });
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

  it("omits remoteip when it is not a valid IP", async () => {
    const fetchImpl = reply({ success: true });
    await verifyTurnstileToken("tok", { fetchImpl, remoteIp: "not-an-ip, 1.2.3.4" });
    expect(sentBody(fetchImpl).has("remoteip")).toBe(false);
  });

  it.each([
    ["success:false", { success: false, "error-codes": ["invalid-input-response"] }],
    ["duplicate (single-use)", { success: false, "error-codes": ["timeout-or-duplicate"] }],
    ["success as a string", { success: "true" }],
    ["no success field", { hostname: "example.com" }],
    ["a JSON array", [true]],
    ["JSON null", null],
  ])("rejects %s", async (_label, body) => {
    expect(await verifyTurnstileToken("tok", { fetchImpl: reply(body) })).toEqual({ ok: false, reason: "rejected" });
  });

  it.each([
    ["a non-2xx status", () => reply({ success: true }, 503)],
    ["malformed JSON", () => vi.fn().mockResolvedValue(new Response("<html>oops", { status: 200 }))],
    ["a network error", () => vi.fn().mockRejectedValue(new TypeError("fetch failed"))],
    ["a timeout", () => vi.fn().mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"))],
  ])("fails closed on %s", async (_label, make) => {
    expect(await verifyTurnstileToken("tok", { fetchImpl: make() })).toEqual({ ok: false, reason: "unavailable" });
  });

  it("uses Cloudflare's always-pass TEST secret only in local dev when no secret is set", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "local");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    const fetchImpl = reply({ success: true });
    expect(await verifyTurnstileToken("tok", { fetchImpl })).toEqual({ ok: true });
    expect(sentBody(fetchImpl).get("secret")).toBe(CLOUDFLARE_TEST_SECRET_ALWAYS_PASS);
  });

  it.each(["staging", "production"])("fails closed in %s when no secret is set — never calls Cloudflare", async (appEnv) => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", appEnv);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    const fetchImpl = reply({ success: true });
    expect(await verifyTurnstileToken("tok", { fetchImpl })).toEqual({ ok: false, reason: "unavailable" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never logs the secret or the token", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m));
    await verifyTurnstileToken("tok-secretive", { fetchImpl: vi.fn().mockRejectedValue(new Error("boom")) });
    await verifyTurnstileToken("tok-secretive", { fetchImpl: reply({ success: false }) });
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
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
