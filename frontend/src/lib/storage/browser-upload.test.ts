import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/client", () => ({ createBrowserSupabaseClient: vi.fn() }));
const release = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("@/server/actions/media-release", () => ({ releaseUploadAction: release }));
import { uploadWithGrant } from "./browser-upload";
const requests: FakeRequest[] = [];
class FakeRequest {
  status = 200; timeout = 0; upload = { onprogress: () => {} };
  onload = () => {}; onerror = () => {}; ontimeout = () => {};
  open = vi.fn(); setRequestHeader = vi.fn(); send = vi.fn();
  constructor() { requests.push(this); }
}
const grant = { provider: "r2" as const, url: "https://isolated.example.test/pending/x", headers: { "content-type": "image/png" }, expiresIn: 120 };
const reservation = { namespace: "request" as const, key: "pending-key" };
beforeEach(() => { release.mockClear(); requests.length = 0; vi.stubGlobal("XMLHttpRequest", FakeRequest); });
it("bounds simultaneous uploads and releases a slot after a failed credential", async () => {
  const uploads = Array.from({ length: 5 }, () => uploadWithGrant(grant, new Blob(["x"]), reservation));
  expect(requests).toHaveLength(4);
  requests[0]!.status = 403;
  const denied = expect(uploads[0]).rejects.toThrow("refused");
  requests[0]!.onload(); await denied;
  expect(requests).toHaveLength(5);
  for (const request of requests.slice(1)) request.onload();
  await Promise.all(uploads.slice(1));
  expect(requests[0]!.open).toHaveBeenCalledWith("PUT", grant.url);
  expect(requests[0]!.timeout).toBe(60_000);
  // only the refused upload frees its reservation
  expect(release.mock.calls).toEqual([["request", "pending-key"]]);
});
it("backs off and retries a service error using the same temporary grant", async () => {
  vi.useFakeTimers();
  const upload = uploadWithGrant(grant, new Blob(["x"]), reservation);
  requests[0]!.status = 503; requests[0]!.onload();
  await vi.advanceTimersByTimeAsync(701);
  expect(requests).toHaveLength(2);
  requests[1]!.onload(); await upload;
  expect(release).not.toHaveBeenCalled();
  vi.useRealTimers();
});
it("reports the upload error even when the release itself fails", async () => {
  release.mockRejectedValueOnce(new Error("offline"));
  const upload = uploadWithGrant(grant, new Blob(["x"]), reservation);
  const denied = expect(upload).rejects.toThrow("refused");
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  requests[0]!.status = 403; requests[0]!.onload();
  await denied;
});
