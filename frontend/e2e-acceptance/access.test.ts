import { describe, expect, it } from "vitest";
import {
  ACCEPTANCE_PREVIEW_ORIGIN as ORIGIN,
  accessHeadersFor,
  isAccessLogin,
  isPreviewOrigin,
  judgePreflight,
  preflight,
  readAccessCredentials,
  scrubError,
} from "./access.mjs";

const creds = { id: "id-value", secret: "secret-value" };
const okBody = JSON.stringify({ status: "ok", service: "backend", env: "staging" });

describe("credentials fail closed", () => {
  it("reads both, trimmed", () => {
    expect(readAccessCredentials({ ACCEPTANCE_E2E_ACCESS_CLIENT_ID: " a ", ACCEPTANCE_E2E_ACCESS_CLIENT_SECRET: " b " })).toEqual({ id: "a", secret: "b" });
  });
  it.each([
    [{}, /ID and .*SECRET/],
    [{ ACCEPTANCE_E2E_ACCESS_CLIENT_ID: "a" }, /ACCESS_CLIENT_SECRET is missing/],
    [{ ACCEPTANCE_E2E_ACCESS_CLIENT_SECRET: "b" }, /ACCESS_CLIENT_ID is missing/],
    [{ ACCEPTANCE_E2E_ACCESS_CLIENT_ID: "  ", ACCEPTANCE_E2E_ACCESS_CLIENT_SECRET: "b" }, /ACCESS_CLIENT_ID is missing/],
  ])("throws without echoing a value: %j", (env, re) => {
    expect(() => readAccessCredentials(env)).toThrow(re);
    try {
      readAccessCredentials(env);
    } catch (e) {
      expect(String(e)).not.toMatch(/secret-value|"a"|"b"/);
    }
  });
});

describe("headers are scoped to the exact preview origin", () => {
  it("attaches both headers on the preview origin only", () => {
    expect(accessHeadersFor(`${ORIGIN}/api/health`, creds)).toEqual({ "CF-Access-Client-Id": "id-value", "CF-Access-Client-Secret": "secret-value" });
  });
  it.each([
    "https://aladdindecore.com/",
    "https://kkpkgjrweysgvhvkhzun.supabase.co/auth/v1/token",
    "https://challenges.cloudflare.com/turnstile/v0/api.js",
    "https://team.cloudflareaccess.com/cdn-cgi/access/login/x",
    "http://aladdin-frontend-preview.bstalent9.workers.dev/",
    "https://aladdin-frontend-preview.bstalent9.workers.dev:8443/",
    "https://aladdin-frontend-preview.bstalent9.workers.dev.evil.example/",
    "https://evil.example/?u=https://aladdin-frontend-preview.bstalent9.workers.dev",
    "https://aladdin-frontend-preview.bstalent9.workers.dev@evil.example/",
    "https://aladdin-backend-preview.bstalent9.workers.dev/",
    "not a url",
  ])("sends nothing to %s", (url) => {
    expect(isPreviewOrigin(url)).toBe(false);
    expect(accessHeadersFor(url, creds)).toEqual({});
  });
});

describe("error scrubbing for the uploaded artifact", () => {
  it("keeps one line and removes both credential values", () => {
    const e = new Error("connect ECONNRESET id-value\n  → GET https://x\n  CF-Access-Client-Secret: secret-value");
    const out = scrubError(e, creds);
    expect(out).toBe("connect ECONNRESET [redacted]");
    expect(out).not.toMatch(/secret-value|id-value|CF-Access/);
    expect(scrubError("plain secret-value text", creds)).toBe("plain [redacted] text");
  });
});

describe("Access login detection", () => {
  it("recognises Access hosts only", () => {
    expect(isAccessLogin("https://team.cloudflareaccess.com/cdn-cgi/access/login/x")).toBe(true);
    expect(isAccessLogin("https://cloudflareaccess.com/")).toBe(true);
    expect(isAccessLogin("https://notcloudflareaccess.com/")).toBe(false);
    expect(isAccessLogin(`${ORIGIN}/auth/sign-in`)).toBe(false);
  });
});

describe("preflight verdict", () => {
  const good = { status: 200, contentType: "application/json", body: okBody };
  it("passes on 200 JSON from the staging backend", () => expect(judgePreflight(good)).toEqual([]));
  it("fails on an Access login redirect", () => {
    expect(judgePreflight({ status: 302, location: "https://team.cloudflareaccess.com/cdn-cgi/access/login/x", body: "" }).join()).toMatch(/Cloudflare Access answered 302/);
    expect(judgePreflight({ status: 302, body: "" }).join()).toMatch(/Cloudflare Access answered 302/);
  });
  it("fails on any other redirect, non-200, non-JSON or wrong environment", () => {
    expect(judgePreflight({ status: 307, location: "/elsewhere", body: "" }).join()).toMatch(/unexpected redirect/);
    expect(judgePreflight({ ...good, status: 403 }).join()).toMatch(/HTTP 403/);
    expect(judgePreflight({ ...good, contentType: "text/html", body: "<html>" }).join()).toMatch(/did not answer JSON/);
    expect(judgePreflight({ ...good, body: JSON.stringify({ status: "ok", service: "backend", env: "production" }) }).join()).toMatch(/not the Acceptance/);
  });
});

describe("preflight request", () => {
  const env = { ACCEPTANCE_E2E_ACCESS_CLIENT_ID: "id-value", ACCEPTANCE_E2E_ACCESS_CLIENT_SECRET: "secret-value" };
  const resp = (status: number, headers: Record<string, string>, body = "") => new Response(body, { status, headers });

  it("sends the headers to the exact health URL, never follows redirects", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const f = (async (u: string, i: RequestInit) => {
      calls.push([u, i]);
      return resp(200, { "content-type": "application/json" }, okBody);
    }) as unknown as typeof fetch;
    expect(await preflight(env, f)).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe(`${ORIGIN}/api/backend/health`);
    expect(calls[0]![1].redirect).toBe("manual");
    expect(calls[0]![1].headers).toEqual({ "CF-Access-Client-Id": "id-value", "CF-Access-Client-Secret": "secret-value" });
  });
  it("fails closed on an Access redirect", async () => {
    const f = (async () => resp(302, { location: "https://team.cloudflareaccess.com/login" })) as unknown as typeof fetch;
    expect((await preflight(env, f)).join()).toMatch(/Cloudflare Access answered 302/);
  });
  it("refuses to send anything without both credentials", async () => {
    let called = false;
    const f = (async () => ((called = true), resp(200, {}))) as unknown as typeof fetch;
    await expect(preflight({ ACCEPTANCE_E2E_ACCESS_CLIENT_ID: "x" }, f)).rejects.toThrow(/missing/);
    expect(called).toBe(false);
  });
});
