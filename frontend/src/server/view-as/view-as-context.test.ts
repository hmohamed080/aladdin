import { describe, expect, it } from "vitest";
import { isViewAsMutation, viewAsContextFor, VIEW_AS_CONTEXT_HEADER } from "./read-only-gate";
import { applyViewAsContext } from "./trusted-context";

const ID = "70000009-0000-4000-8000-000000000009";
const HOST = "app.example";
const hdrs = (init: Record<string, string> = {}) => new Headers({ host: HOST, ...init });
const input = (method: string, pathname: string, h: Record<string, string> = {}) => ({ method, pathname, headers: hdrs(h) });

describe("the trusted x-view-as-context header (boundary b input)", () => {
  it("is 'exact' for the /view-as tree and 'interim' for the custom view, by path, for reads too", () => {
    expect(viewAsContextFor(input("GET", `/view-as/${ID}/points`))).toBe("exact");
    expect(viewAsContextFor(input("GET", `/view-as/${ID}`))).toBe("exact");
    expect(viewAsContextFor(input("GET", `/admin/users/${ID}/view/profile`))).toBe("interim");
  });

  it("is never set for the two session controls (start / exit are the only writes in the tree)", () => {
    for (const base of [`/view-as/${ID}`, `/admin/users/${ID}/view`]) {
      for (const leaf of ["start", "exit"]) expect(viewAsContextFor(input("POST", `${base}/${leaf}`))).toBeNull();
    }
  });

  it("strips a client-supplied value on an ordinary page: it cannot be forged into (or left on) a normal request", () => {
    const h = hdrs({ [VIEW_AS_CONTEXT_HEADER]: "exact" });
    expect(applyViewAsContext(h, { method: "POST", pathname: "/admin/users", headers: h })).toBeNull();
    expect(h.get(VIEW_AS_CONTEXT_HEADER)).toBeNull();
  });

  it("overwrites a forged value with the real one inside the tree", () => {
    const h = hdrs({ [VIEW_AS_CONTEXT_HEADER]: "interim" });
    expect(applyViewAsContext(h, { method: "GET", pathname: `/view-as/${ID}`, headers: h })).toBe("exact");
    expect(h.get(VIEW_AS_CONTEXT_HEADER)).toBe("exact");
  });

  it("marks a NON-READ request made from a view page (Referer in the tree), exact or interim", () => {
    expect(viewAsContextFor(input("POST", "/api/anything", { referer: `https://${HOST}/view-as/${ID}/points` }))).toBe("exact");
    expect(viewAsContextFor(input("POST", "/home", { referer: `https://${HOST}/admin/users/${ID}/view/work` }))).toBe("interim");
  });

  it("does NOT mark a spoofed / foreign / non-view Referer", () => {
    expect(viewAsContextFor(input("POST", "/admin/users", { referer: `https://${HOST}/admin/users` }))).toBeNull();
    expect(viewAsContextFor(input("POST", "/admin/users", { referer: `https://evil.example/view-as/${ID}` }))).toBeNull();
    expect(viewAsContextFor(input("POST", "/admin/users", { referer: "not a url" }))).toBeNull();
  });

  it("does not put the Admin's normal console in read-only mode when they merely navigate out of a view (GET)", () => {
    expect(viewAsContextFor(input("GET", "/admin/users", { referer: `https://${HOST}/view-as/${ID}` }))).toBeNull();
    expect(viewAsContextFor(input("GET", "/admin/users/abc", { referer: `https://${HOST}/admin/users/${ID}/view` }))).toBeNull();
  });

  it("direct mutation attempts are refused at the edge, with and without a Referer, and a forged header changes nothing", () => {
    const post = (path: string, h: Record<string, string> = {}) => isViewAsMutation(input("POST", path, h));
    expect(post(`/view-as/${ID}/points`)).toBe(true); // no Referer
    expect(post(`/view-as/${ID}/points`, { referer: `https://${HOST}/view-as/${ID}` })).toBe(true);
    expect(post(`/view-as/${ID}/points`, { referer: `https://${HOST}/home` })).toBe(true); // spoofed non-view Referer
    expect(post(`/view-as/${ID}/points`, { [VIEW_AS_CONTEXT_HEADER]: "none" })).toBe(true); // forged header
    expect(post(`/view-as/${ID}/start`)).toBe(false);
    expect(post(`/view-as/${ID}/exit`)).toBe(false);
    // the Admin's own console actions are untouched
    expect(post("/admin/users", { referer: `https://${HOST}/admin/users` })).toBe(false);
    expect(post("/admin/roles")).toBe(false);
  });
});
