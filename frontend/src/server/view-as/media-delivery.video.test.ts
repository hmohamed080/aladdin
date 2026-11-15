import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * View-As VIDEO door: the real delivery module against a stateful model of public.admin_view_as_video_open (live / expired /
 * exited session, Auth session binding, ownership, readiness, provider) and a fake R2 that honours Range like the real one.
 * What this cannot prove (needs Acceptance with real R2 and a real Auth session) is in ADMIN_VIEW_AS_ARCHITECTURE.md section 10.
 */
vi.mock("server-only", () => ({}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

const SUBJECT = "71000006-0000-4000-8000-000000000006";
const OTHER = "71000007-0000-4000-8000-000000000007";
const VID = "91000000-0000-4000-8000-000000000001";
const VID_OTHER = "91000000-0000-4000-8000-000000000003";
const VID_PROC = "91000000-0000-4000-8000-000000000002";
const VID_STREAM = "91000000-0000-4000-8000-000000000004";
const REV = "92000000-0000-4000-8000-000000000001";
const PREFIX = `video/${VID}/${REV}/`;
const SIGNED = "https://r2.example/signed?X-Amz-Signature=abc";
const SEG = new Uint8Array(1000).map((_, i) => i % 251);
const MASTER = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n360p/index.m3u8\n";
const MEDIA = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\nseg_00001.m4s\n#EXT-X-ENDLIST\n';

type Video = { owner: string; ready: boolean; r2: boolean; renditions: string[]; poster: boolean };
const db = {
  session: { live: true, expired: false, bound: true },
  videos: new Map<string, Video>(),
  audit: [] as string[],
  rpcCalls: 0,
};
const seed = () => {
  db.session = { live: true, expired: false, bound: true };
  db.audit = []; db.rpcCalls = 0;
  db.videos = new Map([
    [VID, { owner: SUBJECT, ready: true, r2: true, renditions: ["360p"], poster: true }],
    [VID_OTHER, { owner: OTHER, ready: true, r2: true, renditions: ["360p"], poster: true }],
    [VID_PROC, { owner: SUBJECT, ready: false, r2: true, renditions: ["360p"], poster: false }],
    [VID_STREAM, { owner: SUBJECT, ready: true, r2: false, renditions: ["360p"], poster: false }],
  ]);
};

const rpc = vi.fn(async (name: string, args: { p_subject: string; p_video_id: string }) => {
  db.rpcCalls++;
  const refuse = { data: null, error: { code: "42501", message: "not permitted" } };
  if (name !== "admin_view_as_video_open") return refuse;
  const s = db.session;
  if (!s.live || s.expired || !s.bound) return refuse;
  const v = db.videos.get(args.p_video_id);
  if (!v || v.owner !== args.p_subject || !v.ready || !v.r2) return refuse;
  const key = `${args.p_subject}:${args.p_video_id}`;
  if (!db.audit.includes(key)) db.audit.push(key);
  return { data: { prefix: `video/${args.p_video_id}/${REV}/`, revision: REV, renditions: v.renditions, poster: v.poster }, error: null };
});
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(async () => ({ rpc, auth: { getUser } })) }));
const loadAdminAccess = vi.fn();
vi.mock("@/server/authorization/admin", () => ({ loadAdminAccess }));
const consumeRateLimit = vi.fn();
vi.mock("@/server/cache/rate-limit", () => ({ consumeRateLimit }));
const ctor = vi.fn();
const getReadAccess = vi.fn();
vi.mock("@/server/storage/r2-provider", () => ({
  CloudflareR2StorageProvider: class {
    constructor(...args: unknown[]) { ctor(...args); }
    getReadAccess = getReadAccess;
  },
}));

const legacy = await import("@/app/admin/users/[id]/view/media/video/[mediaId]/[...file]/route");
const exact = await import("@/app/view-as/[id]/media/video/[mediaId]/[...file]/route");

/** Fake R2: serves bytes by file (from the signed key recorded in getReadAccess) and honours one Range. */
const fetchMock = vi.fn();
function r2(files: Record<string, Uint8Array | string>) {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    const key = getReadAccess.mock.calls.at(-1)![0] as string;
    const file = key.slice(PREFIX.length);
    const raw = files[file];
    if (raw === undefined) return new Response(null, { status: 404 });
    const body = typeof raw === "string" ? new TextEncoder().encode(raw) : raw;
    const range = (init?.headers as Record<string, string> | undefined)?.range;
    const noise = { etag: "abc", "set-cookie": "x=1", "cache-control": "public, max-age=999", "x-amz-request-id": "r" };
    if (!range) return new Response(body as unknown as BodyInit, { status: 200, headers: { ...noise, "content-length": String(body.length) } });
    const m = /^bytes=(\d*)-(\d*)$/.exec(range)!;
    const [start, rawEnd] = m[1] === "" ? [Math.max(0, body.length - Number(m[2])), body.length - 1] : [Number(m[1]), m[2] === "" ? body.length - 1 : Math.min(Number(m[2]), body.length - 1)];
    if (start >= body.length) return new Response(null, { status: 416, headers: { "content-range": `bytes */${body.length}` } });
    const end = Math.min(rawEnd, body.length - 1);
    return new Response(body.slice(start, end + 1) as unknown as BodyInit, { status: 206, headers: { ...noise, "content-range": `bytes ${start}-${end}/${body.length}`, "content-length": String(end - start + 1) } });
  });
}

const ORIGIN = "https://app.example";
type Tree = "legacy" | "exact";
const call = (file: string, init: { tree?: Tree; id?: string; vid?: string; headers?: Record<string, string>; method?: string } = {}) => {
  const { tree = "exact", id = SUBJECT, vid = VID, method = "GET" } = init;
  const headers = init.headers ?? { "sec-fetch-site": "same-origin" };
  const path = tree === "exact" ? `/view-as/${id}/media/video/${vid}/${file}` : `/admin/users/${id}/view/media/video/${vid}/${file}`;
  const route = tree === "exact" ? exact : legacy;
  return route.GET(new NextRequest(`${ORIGIN}${path}`, { headers, method }), { params: Promise.resolve({ id, mediaId: vid, file: file.split("/") }) });
};
const all = (res: Response) => [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");

let logs: string[];
beforeEach(() => {
  vi.clearAllMocks();
  seed();
  logs = [];
  for (const m of ["log", "info", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((...a) => { logs.push(a.map(String).join(" ")); });
  loadAdminAccess.mockResolvedValue({ isStaff: true, rank: 80, permissions: ["users.view_as"], roles: [] });
  getUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
  consumeRateLimit.mockResolvedValue({ outcome: "allowed" });
  getReadAccess.mockResolvedValue(SIGNED);
  r2({ "master.m3u8": MASTER, "360p/index.m3u8": MEDIA, "360p/init.mp4": SEG, "360p/seg_00001.m4s": SEG, "poster.jpg": SEG });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ADMIN_VIEW_AS_ENABLED", "true");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe.each<Tree>(["exact", "legacy"])("video door, %s tree", (tree) => {
  it("serves the master and media playlists whole (relative URIs, no tickets) and the poster", async () => {
    const m = await call("master.m3u8", { tree });
    expect(m.status).toBe(200);
    expect(await m.text()).toBe(MASTER);
    expect(m.headers.get("content-type")).toBe("application/vnd.apple.mpegurl");
    expect((await call("360p/index.m3u8", { tree })).status).toBe(200);
    const p = await call("poster.jpg", { tree });
    expect(p.status).toBe(200);
    expect(p.headers.get("content-type")).toBe("image/jpeg");
    expect(ctor).toHaveBeenCalledWith("portfolio", "private", `${PREFIX}poster.jpg`);
    expect(getReadAccess).toHaveBeenCalledWith(`${PREFIX}poster.jpg`, 30);
    expect(rpc).toHaveBeenCalledWith("admin_view_as_video_open", { p_subject: SUBJECT, p_video_id: VID });
  });

  it("a full segment is a 200 with its size and Accept-Ranges", async () => {
    const res = await call("360p/seg_00001.m4s", { tree });
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-length")).toBe("1000");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(SEG);
  });

  it.each([
    ["a closed range", "bytes=10-19", "bytes 10-19/1000", 10, 20],
    ["an open-ended range", "bytes=990-", "bytes 990-999/1000", 990, 1000],
    ["a suffix range", "bytes=-5", "bytes 995-999/1000", 995, 1000],
    ["a range cut at EOF", "bytes=995-5000", "bytes 995-999/1000", 995, 1000],
  ])("%s is a 206 with the right Content-Range and exact bytes", async (_n, header, contentRange, a, b) => {
    const res = await call("360p/seg_00001.m4s", { tree, headers: { "sec-fetch-site": "same-origin", range: header } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(contentRange);
    expect(res.headers.get("content-length")).toBe(String(b - a));
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(SEG.slice(a, b));
  });

  it("a range beyond EOF is a 416 with the total", async () => {
    const res = await call("360p/seg_00001.m4s", { tree, headers: { "sec-fetch-site": "same-origin", range: "bytes=5000-6000" } });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */1000");
  });

  it.each(["bytes=0-1,5-9", "bytes=9-3", "bytes=-0", "bytes=x-y", "items=0-1"])("rejects %s with 416 without touching storage", async (header) => {
    const res = await call("360p/seg_00001.m4s", { tree, headers: { "sec-fetch-site": "same-origin", range: header } });
    expect(res.status).toBe(416);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clamps the upstream range to the per-response cap and never forwards more than was asked", async () => {
    await call("360p/seg_00001.m4s", { tree, headers: { "sec-fetch-site": "same-origin", range: "bytes=0-" } });
    const sent = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(sent.range).toBe(`bytes=0-${16 * 1024 * 1024 - 1}`);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: "manual", cache: "no-store" });
    expect(fetchMock.mock.calls[0]![0]).toBe(SIGNED);
  });

  it("repeats the database authorization on EVERY request, before and after the fetch", async () => {
    await call("360p/seg_00001.m4s", { tree, headers: { "sec-fetch-site": "same-origin", range: "bytes=0-9" } });
    expect(rpc).toHaveBeenCalledTimes(2);
    await call("360p/seg_00001.m4s", { tree, headers: { "sec-fetch-site": "same-origin", range: "bytes=10-19" } });
    expect(rpc).toHaveBeenCalledTimes(4);
  });

  it("Exit / expiry / another login session cut playback at the very next range request", async () => {
    const ranged = { "sec-fetch-site": "same-origin", range: "bytes=0-9" };
    expect((await call("360p/seg_00001.m4s", { tree, headers: ranged })).status).toBe(206);
    for (const patch of [{ live: false }, { expired: true }, { bound: false }]) {
      db.session = { live: true, expired: false, bound: true, ...patch };
      const res = await call("360p/seg_00001.m4s", { tree, headers: ranged });
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("");
    }
  });

  it("a view that ends WHILE the file is being fetched serves nothing", async () => {
    rpc.mockImplementationOnce(async (_n, a) => ({ data: { prefix: `video/${a.p_video_id}/${REV}/`, revision: REV, renditions: ["360p"], poster: true }, error: null }))
       .mockImplementationOnce(async () => ({ data: null, error: { code: "42501", message: "not permitted" } }));
    expect((await call("360p/seg_00001.m4s", { tree, headers: { "sec-fetch-site": "same-origin", range: "bytes=0-9" } })).status).toBe(404);
  });

  it("refuses with the same empty 404: other subject, another account's video, not ready, legacy provider, unknown rendition or poster", async () => {
    const refusals = [
      call("master.m3u8", { tree, id: OTHER }),                   // a different subject than the video's owner
      call("master.m3u8", { tree, vid: VID_OTHER }),              // another account's video under this subject
      call("master.m3u8", { tree, vid: VID_PROC }),               // not ready
      call("master.m3u8", { tree, vid: VID_STREAM }),             // not R2 + HLS
      call("720p/index.m3u8", { tree }),                          // rendition the video does not have
      call("master.m3u8", { tree, vid: "91000000-0000-4000-8000-0000000000ff" }),
    ];
    for (const res of await Promise.all(refusals)) {
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("");
    }
    db.videos.get(VID)!.poster = false;
    expect((await call("poster.jpg", { tree })).status).toBe(404);
  });

  it("refuses names that are not video files (traversal, originals, other keys) before any database call", async () => {
    for (const f of ["../../u/x/original.mp4", "original.mp4", "360p/../master.m3u8", "360p/seg_1.m4s", "master.m3u8%00", "360p/index.m3u8.bak", ""]) {
      expect((await call(f, { tree })).status).toBe(404);
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is same-origin only: cross-site, same-site, none and a MISSING Sec-Fetch-Site all fail closed, and a spoofed Referer or Origin changes nothing", async () => {
    for (const headers of [{ "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "none" }, {}] as Record<string, string>[]) {
      expect((await call("master.m3u8", { tree, headers })).status).toBe(404);
    }
    // a forged same-origin Referer/Origin without Sec-Fetch-Site (a non-browser client) is still refused
    for (const headers of [{ referer: `${ORIGIN}/view-as/${SUBJECT}` }, { origin: ORIGIN }, { referer: `${ORIGIN}/`, origin: ORIGIN }] as Record<string, string>[]) {
      expect((await call("master.m3u8", { tree, headers })).status).toBe(404);
    }
    // and a cross-site fetch carrying a same-origin looking Referer is refused too
    expect((await call("master.m3u8", { tree, headers: { "sec-fetch-site": "cross-site", referer: `${ORIGIN}/view-as/${SUBJECT}` } })).status).toBe(404);
    // a same-origin request does NOT need (and is not helped by) a Referer
    expect((await call("master.m3u8", { tree, headers: { "sec-fetch-site": "same-origin", referer: "https://evil.example/" } })).status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("is read-only: no mutating verb is exported and a non-GET never reaches storage", async () => {
    const route = (tree === "exact" ? exact : legacy) as Record<string, unknown>;
    for (const verb of ["POST", "PUT", "PATCH", "DELETE"]) expect(route[verb]).toBeUndefined();
    for (const method of ["POST", "PUT", "DELETE"]) {
      expect((await call("master.m3u8", { tree, method })).status).toBe(404);
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s without access, without a fresh Auth user, or with the feature off, and 429s when the per-admin limit is hit", async () => {
    loadAdminAccess.mockResolvedValue({ isStaff: true, rank: 60, permissions: ["users.verify"], roles: [] });
    expect((await call("master.m3u8", { tree })).status).toBe(404);
    loadAdminAccess.mockResolvedValue({ isStaff: true, rank: 80, permissions: ["users.view_as"], roles: [] });
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await call("master.m3u8", { tree })).status).toBe(404);
    getUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    vi.stubEnv("ADMIN_VIEW_AS_ENABLED", "false");
    expect((await call("master.m3u8", { tree })).status).toBe(404);
    vi.stubEnv("ADMIN_VIEW_AS_ENABLED", "true");
    expect(rpc).not.toHaveBeenCalled();
    consumeRateLimit.mockResolvedValue({ outcome: "limited", retryAfterSeconds: 3 });
    const res = await call("360p/seg_00001.m4s", { tree });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("3");
    expect(consumeRateLimit).toHaveBeenLastCalledWith("view-video-read", "admin-1");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never follows a redirect and refuses an upstream error, a surprise 200 for a range, a wrong Content-Range and oversize bodies", async () => {
    const ranged = { "sec-fetch-site": "same-origin", range: "bytes=0-9" };
    fetchMock.mockImplementation(async () => new Response(null, { status: 302, headers: { location: "https://evil.example/" } }));
    expect((await call("360p/seg_00001.m4s", { tree })).status).toBe(404);
    fetchMock.mockImplementation(async () => new Response(SEG, { status: 200, headers: { "content-length": "1000" } }));
    expect((await call("360p/seg_00001.m4s", { tree, headers: ranged })).status).toBe(404);          // upstream ignored the Range
    fetchMock.mockImplementation(async () => new Response(SEG.slice(0, 10), { status: 206, headers: { "content-range": "bytes 500-509/1000", "content-length": "10" } }));
    expect((await call("360p/seg_00001.m4s", { tree, headers: ranged })).status).toBe(404);          // a range we did not ask for
    fetchMock.mockImplementation(async () => new Response("x", { status: 200, headers: { "content-length": String(1024 * 1024 * 1024) } }));
    expect((await call("360p/seg_00001.m4s", { tree })).status).toBe(404);
    fetchMock.mockImplementation(async () => new Response(MASTER, { status: 200, headers: { "content-length": String(10 * 1024 * 1024) } }));
    expect((await call("master.m3u8", { tree })).status).toBe(404);
  });

  it("refuses a playlist that names anything but this video's own relative files", async () => {
    for (const bad of ["#EXTM3U\nhttps://evil.example/seg.m4s\n", "#EXTM3U\n../../other/seg_00001.m4s\n", '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://k.example/key"\n360p/index.m3u8\n', "#EXTM3U\n720p/index.m3u8\n"]) {
      r2({ "master.m3u8": bad });
      expect((await call("master.m3u8", { tree })).status).toBe(404);
    }
  });

  it("leaks nothing: no storage key, prefix, signed URL or upstream header in any response or log, on success or failure", async () => {
    const outputs: string[] = [];
    for (const [f, h] of [["master.m3u8", undefined], ["360p/seg_00001.m4s", { "sec-fetch-site": "same-origin", range: "bytes=0-9" }], ["360p/seg_00001.m4s", { "sec-fetch-site": "same-origin", range: "bytes=9999-" }]] as const) {
      const res = await call(f, { tree, headers: h as Record<string, string> | undefined });
      outputs.push(all(res), await res.text().catch(() => ""));
    }
    db.session.live = false;
    const refused = await call("master.m3u8", { tree });
    outputs.push(all(refused));
    const joined = [...outputs, ...logs].join("\n");
    for (const secret of [PREFIX, REV, "X-Amz", SIGNED, "r2.example"]) expect(joined).not.toContain(secret);
    const ok = await call("360p/seg_00001.m4s", { tree });   // refused now (session ended) -> still no headers beyond ours
    for (const h of ["etag", "set-cookie", "location", "x-amz-request-id"]) expect(ok.headers.get(h)).toBeNull();
    db.session.live = true;
    const served = await call("360p/seg_00001.m4s", { tree, headers: { "sec-fetch-site": "same-origin", range: "bytes=0-9" } });
    for (const h of ["etag", "set-cookie", "location", "x-amz-request-id"]) expect(served.headers.get(h)).toBeNull();
    expect(served.headers.get("cache-control")).toBe("no-store, no-cache, must-revalidate, private");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(served.headers.get("content-security-policy")).toContain("sandbox");
    expect(served.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("writes one audit row per (session, video) however many segments and ranges are requested", async () => {
    for (const r of ["bytes=0-9", "bytes=10-19", "bytes=-5"]) await call("360p/seg_00001.m4s", { tree, headers: { "sec-fetch-site": "same-origin", range: r } });
    await call("master.m3u8", { tree });
    expect(db.audit).toEqual([`${SUBJECT}:${VID}`]);
  });

  it("never throws: an unexpected failure is the same empty 404", async () => {
    rpc.mockRejectedValueOnce(new Error("boom"));
    expect((await call("master.m3u8", { tree })).status).toBe(404);
    getReadAccess.mockRejectedValueOnce(new Error("R2 credentials are not configured"));
    expect((await call("master.m3u8", { tree })).status).toBe(404);
  });
});
