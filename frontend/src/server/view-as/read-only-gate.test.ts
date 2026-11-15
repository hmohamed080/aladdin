import { describe, expect, it } from "vitest";
import { isViewAsMutation, viewAsReadOnlyResponse } from "./read-only-gate";

const ID = "70000001-0000-4000-8000-000000000001";
const VIEW = `/admin/users/${ID}/view`;
const headers = (h: Record<string, string> = {}) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });
const HOST = "app.example.test";
const from = (path: string) => headers({ host: HOST, referer: `https://${HOST}${path}` });

describe("isViewAsMutation", () => {
  it("never blocks a read, anywhere (navigation, prefetch, media)", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "get"]) {
      expect(isViewAsMutation({ method, pathname: `${VIEW}/profile`, headers: from(`${VIEW}/profile`) })).toBe(false);
      expect(isViewAsMutation({ method, pathname: "/api/media/avatar", headers: from(`${VIEW}/profile`) })).toBe(false);
    }
  });

  it("blocks every non-read request addressed to the view tree: that is how a Server Action reaches the server", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      for (const sub of ["", "/profile", "/work", "/profile/edit", "/points/history"]) {
        expect(isViewAsMutation({ method, pathname: `${VIEW}${sub}`, headers: headers({ "next-action": "abc" }) })).toBe(true);
      }
    }
  });

  it("allows only the two deliberate session controls", () => {
    expect(isViewAsMutation({ method: "POST", pathname: `${VIEW}/start`, headers: headers() })).toBe(false);
    expect(isViewAsMutation({ method: "POST", pathname: `${VIEW}/exit`, headers: headers() })).toBe(false);
    expect(isViewAsMutation({ method: "POST", pathname: `${VIEW}/exit/`, headers: headers() })).toBe(false);
    expect(isViewAsMutation({ method: "POST", pathname: `${VIEW}/exit/extra`, headers: headers() })).toBe(true);
    expect(isViewAsMutation({ method: "POST", pathname: `${VIEW}/startx`, headers: headers() })).toBe(true);
  });

  it("blocks a write made BY a view page to another same-origin URL (a client component calling an API route)", () => {
    expect(isViewAsMutation({ method: "POST", pathname: "/api/upload", headers: from(`${VIEW}/profile`) })).toBe(true);
    expect(isViewAsMutation({ method: "DELETE", pathname: "/api/anything", headers: from(`${VIEW}/work`) })).toBe(true);
    // a Server Action posted from the shell's sign-out button is addressed to the view page itself, so rule 1 covers it
    expect(isViewAsMutation({ method: "POST", pathname: `${VIEW}/profile`, headers: from(`${VIEW}/profile`) })).toBe(true);
  });

  it("leaves the Admin's own console untouched: the same writes from any non-view page are not blocked", () => {
    expect(isViewAsMutation({ method: "POST", pathname: "/admin/users", headers: from("/admin/users") })).toBe(false);
    expect(isViewAsMutation({ method: "POST", pathname: `/admin/users/${ID}`, headers: from(`/admin/users/${ID}`) })).toBe(false);
    expect(isViewAsMutation({ method: "POST", pathname: "/home/profile", headers: from("/home/profile") })).toBe(false);
    expect(isViewAsMutation({ method: "POST", pathname: "/api/upload", headers: headers() })).toBe(false);
  });

  it("ignores a Referer from another site and a malformed one", () => {
    expect(isViewAsMutation({ method: "POST", pathname: "/api/x", headers: headers({ host: HOST, referer: `https://evil.test${VIEW}/profile` }) })).toBe(false);
    expect(isViewAsMutation({ method: "POST", pathname: "/api/x", headers: headers({ host: HOST, referer: "not a url" }) })).toBe(false);
  });

  it("guards the future top-level /view-as/<id> tree the same way", () => {
    const base = `/view-as/${ID}`;
    expect(isViewAsMutation({ method: "POST", pathname: `${base}/profile`, headers: headers({ "next-action": "abc" }) })).toBe(true);
    expect(isViewAsMutation({ method: "POST", pathname: `${base}/exit`, headers: headers() })).toBe(false);
    expect(isViewAsMutation({ method: "POST", pathname: "/api/upload", headers: from(`${base}/work`) })).toBe(true);
    expect(isViewAsMutation({ method: "GET", pathname: `${base}/work`, headers: headers() })).toBe(false);
  });

  it("does not treat a similar-looking path as the view tree", () => {
    expect(isViewAsMutation({ method: "POST", pathname: `/admin/users/${ID}/viewer`, headers: headers() })).toBe(false);
    expect(isViewAsMutation({ method: "POST", pathname: "/admin/users/not-a-uuid/view/profile", headers: headers() })).toBe(false);
  });
});

describe("viewAsReadOnlyResponse", () => {
  it("is a generic, cache-proof 403 that names no subject", async () => {
    const res = viewAsReadOnlyResponse();
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({ error: "view_as_read_only" });
  });
});
