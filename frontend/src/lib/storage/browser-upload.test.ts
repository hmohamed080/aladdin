import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/client", () => ({ createBrowserSupabaseClient: vi.fn() }));
import { uploadWithGrant } from "./browser-upload";
const requests: FakeRequest[] = [];
class FakeRequest {
  status = 200; timeout = 0; upload = { onprogress: () => {} };
  onload = () => {}; onerror = () => {}; ontimeout = () => {};
  open = vi.fn(); setRequestHeader = vi.fn(); send = vi.fn();
  constructor() { requests.push(this); }
}
const grant = { provider: "r2" as const, url: "https://isolated.example.test/pending/x", headers: { "content-type": "image/png" }, expiresIn: 120 };
beforeEach(() => { requests.length = 0; vi.stubGlobal("XMLHttpRequest", FakeRequest); });
it("bounds simultaneous uploads and releases a slot after a failed credential", async () => {
  const uploads = Array.from({ length: 5 }, () => uploadWithGrant(grant, new Blob(["x"])));
  expect(requests).toHaveLength(4);
  requests[0]!.status = 403;
  const denied = expect(uploads[0]).rejects.toThrow("refused");
  requests[0]!.onload(); await denied;
  expect(requests).toHaveLength(5);
  for (const request of requests.slice(1)) request.onload();
  await Promise.all(uploads.slice(1));
  expect(requests[0]!.open).toHaveBeenCalledWith("PUT", grant.url);
  expect(requests[0]!.timeout).toBe(60_000);
});
it("backs off and retries a service error using the same temporary grant", async () => {
  vi.useFakeTimers();
  const upload = uploadWithGrant(grant, new Blob(["x"]));
  requests[0]!.status = 503; requests[0]!.onload();
  await vi.advanceTimersByTimeAsync(701);
  expect(requests).toHaveLength(2);
  requests[1]!.onload(); await upload;
  vi.useRealTimers();
});
