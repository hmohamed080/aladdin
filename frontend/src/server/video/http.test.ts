import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./uploads", () => ({ VideoUploadError: class extends Error { constructor(readonly code: string) { super(code); } } }));
import { failure, readJson, refuseCrossSite } from "./http";
import { VideoUploadError } from "./uploads";

const req = (method: string, headers: Record<string, string> = {}) =>
  new Request("http://localhost:3000/api/video/uploads", { method, headers: { host: "app.test", ...headers } });

it("accepts same-origin JSON writes", () => {
  expect(refuseCrossSite(req("POST", { origin: "https://app.test", "content-type": "application/json" }))).toBeNull();
  expect(refuseCrossSite(req("DELETE", { origin: "https://app.test" }))).toBeNull();
  expect(refuseCrossSite(req("GET"))).toBeNull();
  // Behind a proxy the addressed host arrives as x-forwarded-host.
  expect(refuseCrossSite(req("POST", { origin: "https://www.app.test", "x-forwarded-host": "www.app.test", "content-type": "application/json" }))).toBeNull();
});
it("refuses other origins, writes without an origin, and non-JSON bodies", () => {
  expect(refuseCrossSite(req("POST", { origin: "https://evil.test", "content-type": "application/json" }))?.status).toBe(403);
  expect(refuseCrossSite(req("GET", { origin: "https://evil.test" }))?.status).toBe(403);
  expect(refuseCrossSite(req("POST", { "content-type": "application/json" }))?.status).toBe(403);
  expect(refuseCrossSite(req("POST", { origin: "null", "content-type": "application/json" }))?.status).toBe(403);
  expect(refuseCrossSite(req("POST", { origin: "https://app.test.evil.test", "content-type": "application/json" }))?.status).toBe(403);
  expect(refuseCrossSite(req("POST", { origin: "https://app.test", "content-type": "text/plain" }))?.status).toBe(415);
});
it("caps bodies at 4 KB and rejects malformed JSON", async () => {
  await expect(readJson(new Request("https://app.test", { method: "POST", body: "x".repeat(5000) }))).rejects.toBeInstanceOf(VideoUploadError);
  await expect(readJson(new Request("https://app.test", { method: "POST", body: "{" }))).rejects.toBeInstanceOf(VideoUploadError);
  expect(await readJson(new Request("https://app.test", { method: "POST", body: '{"a":1}' }))).toEqual({ a: 1 });
});
it("maps errors to statuses and never leaks internal messages", async () => {
  const limited = failure(new VideoUploadError("rate_limited"));
  expect(limited.status).toBe(429);
  const unknown = failure(new Error("secret detail"));
  expect(unknown.status).toBe(503);
  expect(await unknown.json()).toEqual({ error: "unavailable" });
  expect(unknown.headers.get("cache-control")).toBe("private, no-store");
});
