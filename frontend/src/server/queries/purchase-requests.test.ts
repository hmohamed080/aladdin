import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { discoverRequestsPage, getMyRequest, getRequestForWorkspace, listResponsesForRequester, signRequestImageUrls } from "./purchase-requests";

type Call = [string, ...unknown[]];
const ORG = "9c000000-cccc-4ccc-8ccc-000000000001";
const REQ = "46d3bc5b-16a1-4aa0-966e-274673264654";

function stub(results: { rpc?: { data: unknown; error: unknown; count?: number }; tables?: Record<string, { data: unknown; error: unknown }>; storage?: { createSignedUrls: (k: string[], s: number) => unknown } }) {
  const calls: Call[] = [];
  const make = (result: unknown) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "eq", "is", "contains", "ilike", "range"]) {
      b[m] = (...args: unknown[]) => {
        calls.push([m, ...args]);
        return b;
      };
    }
    b.maybeSingle = () => Promise.resolve(result);
    b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return b;
  };
  const supabase = {
    rpc: (fn: string, args: unknown, opts?: unknown) => {
      calls.push(["rpc", fn, args, opts]);
      return make(results.rpc ?? { data: null, error: null });
    },
    from: (table: string) => {
      calls.push(["from", table]);
      return make(results.tables?.[table] ?? { data: null, error: null });
    },
    storage: { from: () => results.storage },
  };
  return { supabase: supabase as never, calls };
}

describe("discovery", () => {
  it("reads only through the workspace-aware reader, newest first, one bounded batch with the exact total", async () => {
    const { supabase, calls } = stub({ rpc: { data: [{ id: "r1", title: "A" }], error: null, count: 12 } });
    const out = await discoverRequestsPage(supabase, ORG, {}, 0, 10);
    expect(out).toEqual({ rows: [{ id: "r1", title: "A" }], total: 12 });
    expect(calls[0]).toEqual(["rpc", "purchase_requests_discover", { p_org_id: ORG }, { count: "exact" }]);
    expect(calls).toContainEqual(["order", "published_at", { ascending: false }]);
    expect(calls).toContainEqual(["order", "id", { ascending: false }]);
    expect(calls).toContainEqual(["range", 0, 9]);
    expect(calls.some((c) => c[0] === "from")).toBe(false);
  });

  it("filters by canonical category and a sanitized title search", async () => {
    const { supabase, calls } = stub({ rpc: { data: [], error: null } });
    await discoverRequestsPage(supabase, ORG, { categoryCode: "paints", search: "villa,(x)" }, 20, 10);
    expect(calls).toContainEqual(["contains", "category_codes", ["paints"]]);
    const like = calls.find((c) => c[0] === "ilike")!;
    expect(like[1]).toBe("title");
    expect(String(like[2])).not.toMatch(/[,()]/);
    expect(calls).toContainEqual(["range", 20, 29]);
  });

  it("switching workspace changes the reader argument - never a union", async () => {
    const a = stub({ rpc: { data: [], error: null } });
    const b = stub({ rpc: { data: [], error: null } });
    await discoverRequestsPage(a.supabase, "org-a", {}, 0, 10);
    await discoverRequestsPage(b.supabase, "org-b", {}, 0, 10);
    expect(a.calls[0]![2]).toEqual({ p_org_id: "org-a" });
    expect(b.calls[0]![2]).toEqual({ p_org_id: "org-b" });
  });

  it("propagates a database error so the route's error state shows (never an empty feed)", async () => {
    const { supabase } = stub({ rpc: { data: null, error: new Error("boom") } });
    await expect(discoverRequestsPage(supabase, ORG, {}, 0, 10)).rejects.toThrow("boom");
  });
});

describe("detail and the requester side", () => {
  it("opens a request for the workspace through the reader; an unreadable one is simply null", async () => {
    const { supabase, calls } = stub({ rpc: { data: null, error: null } });
    expect(await getRequestForWorkspace(supabase, ORG, REQ)).toBeNull();
    expect(calls[0]).toEqual(["rpc", "purchase_request_detail", { p_org_id: ORG, p_request_id: REQ }, undefined]);
    expect(await getRequestForWorkspace(supabase, ORG, "not-a-uuid")).toBeNull();
    expect(calls.filter((c) => c[0] === "rpc")).toHaveLength(1);
  });

  it("reads the requester's own request from the owner-side tables with its READY images", async () => {
    const { supabase, calls } = stub({
      tables: {
        purchase_requests: { data: { id: REQ, title: "T" }, error: null },
        purchase_request_items: { data: [{ id: "i1", position: 1, name: "Tile", code: null, category_code: "paints", color_items: [], quantity: 4, unit: "pail", specs: null }], error: null },
        purchase_request_images: { data: [{ id: "m1", item_id: "i1", object_key: "k", slot: 1 }], error: null },
      },
    });
    const own = await getMyRequest(supabase, REQ);
    expect(own?.items[0]).toMatchObject({ id: "i1", images: [{ id: "m1", key: "k", slot: 1 }] });
    expect(calls).toContainEqual(["eq", "state", "ready"]);
  });

  it("lists every submitted response shortlist-first then cheapest", async () => {
    const mk = (id: string, total: number, shortlisted: boolean) => ({ id, request_id: REQ, status: "submitted", coverage: "full", total, shortlisted, items: [] });
    const { supabase } = stub({ rpc: { data: [mk("a", 300, false), mk("b", 500, true), mk("c", 100, false)], error: null } });
    expect((await listResponsesForRequester(supabase, REQ)).map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(await listResponsesForRequester(supabase, "nope")).toEqual([]);
  });
});

describe("reference image URLs", () => {
  it("maps each distinct key to the authorized application media URL, scoped to the viewing workspace", async () => {
    const { supabase, calls } = stub({});
    const urls = await signRequestImageUrls(supabase, ["k", null, "k"], { orgId: ORG });
    expect(urls.size).toBe(1);
    expect(urls.get("k")).toBe(`/api/media/request?key=k&workspace=${ORG}`);
    expect(calls).toEqual([]); // no grant table, no Storage call: authorization happens per request in the database
  });
  it("the requester's own images carry no workspace", async () => {
    const { supabase } = stub({});
    expect((await signRequestImageUrls(supabase, ["k"])).get("k")).toBe("/api/media/request?key=k");
  });
});
