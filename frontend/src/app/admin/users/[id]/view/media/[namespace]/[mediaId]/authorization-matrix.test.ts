import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Private-media AUTHORIZATION MATRIX for the Admin View-As media route.
 *
 * route.test.ts pins the delivery mechanics with a canned RPC answer. This file instead runs the real route against a small
 * STATEFUL model of what the database function admin_view_as_media_open decides (live/expired/exited view session, Auth
 * session binding, ownership, readiness) and a fake object store that returns real bytes, so each authorization story is
 * exercised end to end: allowed viewer -> exact bytes; every refusal -> the SAME generic response; nothing leaks; no redirect
 * is ever followed; no service-role client is reachable.
 *
 * What this file CANNOT prove (needs Acceptance with real R2 bytes + a real Auth session): that the SQL function really makes
 * these decisions (pgTAP 131 + 134 prove that locally against a real database), that the signed R2 URL really serves the
 * object, and that a real Auth session expires/revokes. See docs/admin/ADMIN_VIEW_AS_ACCEPTANCE_VALIDATION.md.
 */
vi.mock("server-only", () => ({}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

type Session = { live: boolean; expired: boolean; bound: boolean };
type Row = { owner: string; namespace: string; ready: boolean; r2: boolean; object: string; contentType: string };
const db = {
  session: { live: true, expired: false, bound: true } as Session,
  rows: new Map<string, Row>(),
  audit: [] as string[],
  calls: [] as string[],
};

const SUBJECT = "71000006-0000-4000-8000-000000000006";
const OTHER = "71000007-0000-4000-8000-000000000007";
const IMG = "a1000000-0000-4000-8000-000000000001";
const CERT = "c1000000-0000-4000-8000-000000000001";
const OTHER_CERT = "c2000000-0000-4000-8000-000000000002";
const NOPE = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3, 250, 251, 252, 253]);
const PDF = Uint8Array.from([...new TextEncoder().encode("%PDF-1.7\n"), 0, 255, 128, 10, 13]);
const BYTES: Record<string, Uint8Array> = {
  "avatar/u/subject/avatar.png": PNG,
  "certificate/u/subject/cert.pdf": PDF,
  "certificate/u/other/cert.pdf": PDF,
};

function seed() {
  db.session = { live: true, expired: false, bound: true };
  db.audit = [];
  db.calls = [];
  db.rows = new Map([
    [IMG, { owner: SUBJECT, namespace: "avatar", ready: true, r2: true, object: "avatar/u/subject/avatar.png", contentType: "image/png" }],
    [CERT, { owner: SUBJECT, namespace: "certificate", ready: true, r2: true, object: "certificate/u/subject/cert.pdf", contentType: "application/pdf" }],
    [OTHER_CERT, { owner: OTHER, namespace: "certificate", ready: true, r2: true, object: "certificate/u/other/cert.pdf", contentType: "application/pdf" }],
  ]);
}

/** Mirrors the decisions of public.admin_view_as_media_open; every refusal is the same error. */
const rpc = vi.fn(async (name: string, args: { p_subject: string; p_namespace: string; p_media_id: string }) => {
  db.calls.push(name);
  const refuse = { data: null, error: { code: "42501", message: "not permitted" } };
  if (name !== "admin_view_as_media_open") return refuse;
  const { live, expired, bound } = db.session;
  if (!live || expired || !bound) return refuse;
  const row = db.rows.get(args.p_media_id);
  if (!row || row.owner !== args.p_subject || row.namespace !== args.p_namespace || !row.ready || !row.r2) return refuse;
  if (!db.audit.includes(args.p_media_id)) db.audit.push(args.p_media_id);
  return { data: { object: row.object, contentType: row.contentType }, error: null };
});
const getUser = vi.fn();
const getServerSupabase = vi.fn(async () => ({ rpc, auth: { getUser } }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase }));
const loadAdminAccess = vi.fn();
vi.mock("@/server/authorization/admin", () => ({ loadAdminAccess }));
vi.mock("@/server/cache/rate-limit", () => ({ consumeRateLimit: vi.fn(async () => ({ outcome: "allowed" })) }));
// Any import of a service-role client would blow up the moment the route touches it.
const serviceRoleTouched = vi.fn();
vi.mock("@/lib/supabase/admin-server", () => new Proxy({}, { get: () => { serviceRoleTouched(); throw new Error("service-role client must never be reachable from View-As media"); } }));
vi.mock("@/server/storage/media", () => new Proxy({}, { get: () => { serviceRoleTouched(); throw new Error("shared media resolver must never be reachable from View-As media"); } }));
const getReadAccess = vi.fn(async (object: string) => `https://r2.example/signed/${object}?X-Amz-Signature=abc`);
vi.mock("@/server/storage/r2-provider", () => ({ CloudflareR2StorageProvider: class { getReadAccess = getReadAccess; } }));

const { GET } = await import("./route");

const ORIGIN = "https://app.example";
const call = (namespace: string, media: string, subject = SUBJECT) =>
  GET(new NextRequest(`${ORIGIN}/admin/users/${subject}/view/media/${namespace}/${media}`, { headers: { "sec-fetch-site": "same-origin" } }), {
    params: Promise.resolve({ id: subject, namespace, mediaId: media }),
  });
/** status + sorted headers + body bytes: two responses are "the same refusal" only if all of it is identical. */
async function fingerprint(res: Response) {
  const headers = [...res.headers.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}: ${v}`).join("\n");
  return `${res.status}\n${headers}\n${Buffer.from(await res.arrayBuffer()).toString("hex")}`;
}
const bytesOf = async (res: Response) => new Uint8Array(await res.arrayBuffer());

const fetchMock = vi.fn();
const storeFetch = async (url: string) => {
  const key = decodeURIComponent(new URL(url).pathname.replace("/signed/", ""));
  const body = BYTES[key];
  return body ? new Response(body as unknown as BodyInit, { status: 200, headers: { etag: "e", "set-cookie": "s=1" } }) : new Response(null, { status: 404 });
};

beforeEach(() => {
  seed();
  vi.clearAllMocks();
  loadAdminAccess.mockResolvedValue({ isStaff: true, rank: 80, permissions: ["users.view_as"], roles: [] });
  getUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
  fetchMock.mockImplementation(storeFetch);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ADMIN_VIEW_AS_ENABLED", "true");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-must-not-be-used");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("allowed viewer (live, audited, Auth-bound view session)", () => {
  it("receives the exact bytes of an image through the same-origin route", async () => {
    const res = await call("avatar", IMG);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(await bytesOf(res)).toEqual(PNG);
    expect(db.audit).toEqual([IMG]);
  });

  it("receives the exact bytes of a certificate (binary PDF) through the same-origin route", async () => {
    const res = await call("certificate", CERT);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(await bytesOf(res)).toEqual(PDF);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
  });

  it("never echoes the physical key or a signed URL, and forwards no upstream header", async () => {
    const res = await call("certificate", CERT);
    const text = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
    expect(text).not.toContain("certificate/u/subject");
    expect(text).not.toContain("X-Amz");
    for (const h of ["etag", "set-cookie", "location"]) expect(res.headers.get(h)).toBeNull();
    await res.arrayBuffer();
  });
});

describe("every refusal is the SAME generic response (no existence or ownership oracle)", () => {
  const refusals: Array<[string, () => Promise<Response>, { storageTouched: boolean }]> = [
    ["caller without users.view_as", async () => { loadAdminAccess.mockResolvedValue({ isStaff: true, rank: 60, permissions: ["users.verify"], roles: [] }); return call("certificate", CERT); }, { storageTouched: false }],
    ["non-staff caller", async () => { loadAdminAccess.mockResolvedValue({ isStaff: false, rank: 0, permissions: [], roles: [] }); return call("certificate", CERT); }, { storageTouched: false }],
    ["signed-out / expired Auth session (getUser returns no user)", async () => { getUser.mockResolvedValue({ data: { user: null }, error: { message: "jwt expired" } }); return call("certificate", CERT); }, { storageTouched: false }],
    ["view session that expired", async () => { db.session.expired = true; return call("certificate", CERT); }, { storageTouched: false }],
    ["view session that was exited before the request", async () => { db.session.live = false; return call("certificate", CERT); }, { storageTouched: false }],
    ["view session bound to a DIFFERENT Auth session", async () => { db.session.bound = false; return call("certificate", CERT); }, { storageTouched: false }],
    ["media id that belongs to another account", async () => call("certificate", OTHER_CERT), { storageTouched: false }],
    ["media id in the wrong namespace", async () => call("avatar", CERT), { storageTouched: false }],
    ["media id that does not exist", async () => call("certificate", NOPE), { storageTouched: false }],
    ["pending media", async () => { db.rows.get(CERT)!.ready = false; return call("certificate", CERT); }, { storageTouched: false }],
    ["media not on a verified R2 location", async () => { db.rows.get(CERT)!.r2 = false; return call("certificate", CERT); }, { storageTouched: false }],
    ["Exit View-As in the middle of the fetch (re-authorization after the bytes arrive)", async () => {
      fetchMock.mockImplementation(async (url: string) => { const r = await storeFetch(url); db.session.live = false; return r; });
      return call("certificate", CERT);
    }, { storageTouched: true }],
    ["view session expiring in the middle of the fetch", async () => {
      fetchMock.mockImplementation(async (url: string) => { const r = await storeFetch(url); db.session.expired = true; return r; });
      return call("avatar", IMG);
    }, { storageTouched: true }],
    ["object swapped in the middle of the fetch", async () => {
      fetchMock.mockImplementation(async (url: string) => { const r = await storeFetch(url); db.rows.get(CERT)!.object = "certificate/u/other/cert.pdf"; return r; });
      return call("certificate", CERT);
    }, { storageTouched: true }],
  ];

  it.each(refusals)("%s", async (_name, run, { storageTouched }) => {
    const res = await run();
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(fetchMock.mock.calls.length > 0).toBe(storageTouched);
  });

  it("the refusals are byte-identical to each other (status, headers and body), not merely all 404", async () => {
    const seen = new Set<string>();
    for (const [, run] of refusals) {
      seed();
      vi.clearAllMocks();
      loadAdminAccess.mockResolvedValue({ isStaff: true, rank: 80, permissions: ["users.view_as"], roles: [] });
      getUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
      fetchMock.mockImplementation(storeFetch);
      seen.add(await fingerprint(await run()));
    }
    expect(seen.size).toBe(1);
  });

  it("a request-time refusal is identical to an upstream failure too (404 / 5xx / redirect / oversized / wrong type)", async () => {
    const baseline = await (async () => { db.session.live = false; return fingerprint(await call("certificate", CERT)); })();
    for (const upstream of [
      () => new Response(null, { status: 404 }),
      () => new Response(null, { status: 503 }),
      () => new Response(null, { status: 301, headers: { location: "https://evil.example/x" } }),
      () => new Response(null, { status: 302, headers: { location: "https://evil.example/x" } }),
      () => new Response(null, { status: 307, headers: { location: "https://evil.example/x" } }),
      () => new Response(PDF as unknown as BodyInit, { status: 200, headers: { "content-length": String(10 * 1024 * 1024 * 1024) } }),
    ]) {
      seed();
      fetchMock.mockImplementation(async () => upstream());
      expect(await fingerprint(await call("certificate", CERT))).toBe(baseline);
    }
    seed();
    db.rows.get(CERT)!.contentType = "text/html";
    expect(await fingerprint(await call("certificate", CERT))).toBe(baseline);
  });

  it("a refused request writes no audit row", async () => {
    db.rows.get(CERT)!.owner = OTHER;
    await call("certificate", CERT);
    db.session.live = false;
    await call("avatar", IMG);
    expect(db.audit).toEqual([]);
  });
});

describe("redirects are never followed", () => {
  it.each([301, 302, 303, 307, 308])("an upstream %i is refused after exactly ONE storage request", async (status) => {
    fetchMock.mockImplementation(async () => new Response(null, { status, headers: { location: "https://evil.example/steal" } }));
    const res = await call("certificate", CERT);
    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: "manual" });
    expect(new URL(fetchMock.mock.calls[0]![0] as string).host).toBe("r2.example");
  });
});

describe("no service-role client and no other RPC", () => {
  it("uses only the caller's own Supabase session and calls only admin_view_as_media_open, even with a service-role key in the environment", async () => {
    await (await call("certificate", CERT)).arrayBuffer();
    await call("certificate", NOPE);
    expect(getServerSupabase).toHaveBeenCalled();
    expect(serviceRoleTouched).not.toHaveBeenCalled();
    expect(new Set(db.calls)).toEqual(new Set(["admin_view_as_media_open"]));
  });

  it("serves GET only: a mutating verb has no handler", async () => {
    const mod = (await import("./route")) as Record<string, unknown>;
    for (const verb of ["POST", "PUT", "PATCH", "DELETE"]) expect(mod[verb]).toBeUndefined();
  });
});
