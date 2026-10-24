import { describe, expect, it, vi } from "vitest";
import { backendOrigin, isBackendPath, proxyToBackend } from "./backend-proxy";

const config = { origin: "https://backend.example.com", appEnv: "production" };

describe("backend proxy (Cloudflare frontend)", () => {
  it("matches only /api/backend and its subpaths", () => {
    expect(isBackendPath("/api/backend")).toBe(true);
    expect(isBackendPath("/api/backend/health")).toBe(true);
    expect(isBackendPath("/api/backendx")).toBe(false);
    expect(isBackendPath("/api/health")).toBe(false);
  });

  it("accepts only a bare https origin, or loopback http in local tests", () => {
    expect(backendOrigin(config)?.href).toBe("https://backend.example.com/");
    expect(backendOrigin({ origin: "http://backend.example.com", appEnv: "production" })).toBeNull();
    expect(backendOrigin({ origin: "http://127.0.0.1:8000", appEnv: "production" })).toBeNull();
    expect(backendOrigin({ origin: "http://127.0.0.1:8000", appEnv: "local" })?.port).toBe("8000");
    expect(backendOrigin({ origin: "https://backend.example.com/api", appEnv: "production" })).toBeNull();
    expect(backendOrigin({ origin: "https://u:p@backend.example.com", appEnv: "production" })).toBeNull();
    expect(backendOrigin({ origin: undefined, appEnv: "production" })).toBeNull();
  });

  it("forwards path, query, method, body and headers, without hop-by-hop headers", async () => {
    const send = vi.fn(async (request: Request) => Response.json({ seen: await request.text() }, { status: 201 }));
    const request = new Request("https://aladdindecore.com/api/backend/documents?x=1", {
      method: "POST",
      headers: { authorization: "Bearer jwt", cookie: "sb=1", connection: "keep-alive", "cf-connecting-ip": "203.0.113.9", "content-type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    const response = await proxyToBackend(request, config, send as unknown as typeof fetch);
    expect(response.status).toBe(201);
    const sent = send.mock.calls[0]![0] as Request;
    expect(sent.url).toBe("https://backend.example.com/api/backend/documents?x=1");
    expect(sent.method).toBe("POST");
    expect(sent.redirect).toBe("manual");
    expect(sent.headers.get("authorization")).toBe("Bearer jwt");
    expect(sent.headers.get("cookie")).toBeNull();
    expect(sent.headers.get("connection")).toBeNull();
    expect(sent.headers.get("x-forwarded-host")).toBe("aladdindecore.com");
    expect(sent.headers.get("x-forwarded-proto")).toBe("https");
    expect(sent.headers.get("x-forwarded-for")).toBe("203.0.113.9");
    expect(await response.json()).toEqual({ seen: '{"a":1}' });
  });

  it("answers 503 when no backend is configured and 502 when it is unreachable", async () => {
    const request = new Request("https://aladdindecore.com/api/backend/health");
    expect((await proxyToBackend(request, { origin: undefined, appEnv: "production" })).status).toBe(503);
    const failing = vi.fn(async () => { throw new TypeError("network"); });
    expect((await proxyToBackend(request, config, failing as unknown as typeof fetch)).status).toBe(502);
  });

  it("prefers the BACKEND service binding over BACKEND_ORIGIN, with the same request", async () => {
    const binding = { fetch: vi.fn(async (request: Request) => Response.json({ seen: await request.text() })) };
    const origin = vi.fn(async () => new Response("wrong transport"));
    const request = new Request("https://aladdindecore.com/api/backend/documents?x=1", {
      method: "POST",
      headers: { authorization: "Bearer jwt", connection: "keep-alive", "cf-connecting-ip": "203.0.113.9" },
      body: "payload",
    });
    const response = await proxyToBackend(request, { ...config, binding }, origin as unknown as typeof fetch);
    expect(origin).not.toHaveBeenCalled();
    const sent = binding.fetch.mock.calls[0]![0];
    expect(new URL(sent.url).pathname).toBe("/api/backend/documents");
    expect(new URL(sent.url).search).toBe("?x=1");
    expect(sent.method).toBe("POST");
    expect(sent.redirect).toBe("manual");
    expect(sent.headers.get("authorization")).toBe("Bearer jwt");
    expect(sent.headers.get("connection")).toBeNull();
    expect(sent.headers.get("x-forwarded-host")).toBe("aladdindecore.com");
    expect(sent.headers.get("x-forwarded-for")).toBe("203.0.113.9");
    expect(await response.json()).toEqual({ seen: "payload" });
  });

  it("uses the binding even when no origin is set, and answers 502 when the binding throws", async () => {
    const request = new Request("https://aladdindecore.com/api/backend/health");
    const ok = { fetch: vi.fn(async () => Response.json({ status: "ok" })) };
    expect((await proxyToBackend(request, { origin: undefined, appEnv: "production", binding: ok })).status).toBe(200);
    const broken = { fetch: vi.fn(async () => { throw new Error("binding down"); }) };
    const response = await proxyToBackend(request, { origin: undefined, appEnv: "production", binding: broken });
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
