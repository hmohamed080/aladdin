import { beforeEach, describe, expect, it } from "vitest";
import vectors from "./video-ticket-vectors.json";
import { createHandler } from "../src/handler";
import { parseTicketKeys } from "../src/ticket";
import { rewritePlaylist } from "../src/video";
import { signVideoTicket, verifyVideoTicket, type VideoTicketClaims } from "../src/video-ticket";
import type { ByteCacheLike, Env, MediaAuthority, R2BucketLike } from "../src/types";

const NOW = vectors.now;
const keys = parseTicketKeys(JSON.stringify(vectors.keys));
const VIDEO = "ea200000-0000-4000-8000-000000000001";
const VIEWER = "70000009-0000-4000-8000-000000000009";
const SESSION = "ea000000-0000-4000-8000-000000000001";
const REV = "ea100000-0000-4000-8000-000000000001";
const PREFIX = `video/${VIDEO}/${REV}/`;
const SEGMENT = new Uint8Array(Array.from({ length: 1000 }, (_, i) => i % 251));

const MASTER = "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360\n360p/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\n720p/index.m3u8\n";
const MEDIA = "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:4\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:4.0,\nseg_00000.m4s\n#EXTINF:2.0,\nseg_00001.m4s\n#EXT-X-ENDLIST\n";

type Db = { ready: boolean; published: boolean; owner: string; sessionLive: boolean };
let db: Db;
let calls: { video: number; closed: number; requests: { viewer: string | null; expiresAt: number | null }[] };

function authority(): MediaAuthority {
  return {
    async authorizePrivate() { return null; },
    async authorizePublic() { return null; },
    async authorizeVideo(r) {
      calls.video++;
      calls.requests.push({ viewer: r.viewer, expiresAt: r.expiresAt });
      if (!db.ready || r.video !== VIDEO) return null;
      const grant = { prefix: PREFIX, revision: REV, renditions: ["360p", "720p"], poster: true, public: db.published };
      if (r.viewer === null) return db.published ? grant : null;
      if (!db.sessionLive || r.session !== SESSION || r.expiresAt === null || r.expiresAt < NOW - 5) return null;
      return db.published || r.viewer === db.owner ? grant : null;
    },
    async close() { calls.closed++; },
  };
}

const enc = new TextEncoder();
const objects: Record<string, Uint8Array<ArrayBuffer>> = {
  [`${PREFIX}master.m3u8`]: enc.encode(MASTER),
  [`${PREFIX}360p/index.m3u8`]: enc.encode(MEDIA),
  [`${PREFIX}720p/index.m3u8`]: enc.encode(MEDIA),
  [`${PREFIX}360p/init.mp4`]: new Uint8Array([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]),
  [`${PREFIX}360p/seg_00000.m4s`]: SEGMENT,
  [`${PREFIX}poster.jpg`]: new Uint8Array([0xff, 0xd8, 0xff]),
};
const bucket: R2BucketLike = {
  async get(key, options) {
    const bytes = objects[key];
    if (!bytes) return null;
    const slice = options?.range ? bytes.slice(options.range.offset, options.range.offset + options.range.length) : bytes;
    return { size: bytes.length, body: new Blob([slice]).stream() };
  },
  async head(key) { const b = objects[key]; return b ? { size: b.length } : null; },
};

let env: Env;
let cacheStore: Map<string, Response>;
const cache: ByteCacheLike = {
  async match(key) { return cacheStore.get(key)?.clone(); },
  async put(key, response) { cacheStore.set(key, new Response(await response.arrayBuffer(), { headers: response.headers })); },
};
const waits: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => { waits.push(p); } };
const handle = createHandler({ authority: () => authority(), now: () => NOW * 1000, cache: () => cache });

const pageClaims = (over: Partial<VideoTicketClaims> = {}): VideoTicketClaims =>
  ({ v: 1, vid: VIDEO, sub: VIEWER, sid: SESSION, ws: null, use: "page", exp: NOW + 90, ...over });
const sign = (claims: VideoTicketClaims) => signVideoTicket("k1", keys.get("k1")!, claims);
const get = (path: string, headers: Record<string, string> = {}, method = "GET") =>
  handle(new Request(`https://media.example${path}`, { method, headers }), env, ctx);

beforeEach(() => {
  db = { ready: true, published: false, owner: VIEWER, sessionLive: true };
  calls = { video: 0, closed: 0, requests: [] };
  cacheStore = new Map();
  env = { MEDIA_BUCKET: bucket, HYPERDRIVE: { connectionString: "postgres://unused" }, TICKET_KEYS: JSON.stringify(vectors.keys),
    VIDEO_ROUTES: "on", EDGE_CACHE: "on", VIDEO_ALLOWED_ORIGINS: "https://app.example" };
});

describe("video tickets", () => {
  it("verify the shared vectors and refuse every invalid one", async () => {
    for (const v of vectors.valid) {
      expect(await verifyVideoTicket(v.ticket, keys, NOW)).toEqual(v.claims);
      expect(await sign(v.claims as VideoTicketClaims)).toBe(v.ticket);
    }
    for (const v of vectors.invalid) expect(await verifyVideoTicket(v.ticket, keys, NOW), v.reason).toBeNull();
  });
});

describe("private playback", () => {
  it("swaps the page ticket for a four-hour play ticket in every playlist URI", async () => {
    const response = await get(`/v/${VIDEO}/master.m3u8?t=${await sign(pageClaims())}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/vnd.apple.mpegurl");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.text();
    const uris = body.split("\n").filter((l) => l && !l.startsWith("#"));
    expect(uris).toHaveLength(2);
    const play = new URL(`https://x/${uris[0]}`).searchParams.get("t")!;
    const claims = await verifyVideoTicket(play, keys, NOW);
    expect(claims).toMatchObject({ use: "play", vid: VIDEO, sub: VIEWER, sid: SESSION, exp: NOW + 4 * 3600 });
    // The play ticket reaches the media playlist and is passed to init and segments.
    const media = await (await get(`/v/${VIDEO}/360p/index.m3u8?t=${play}`)).text();
    expect(media).toContain(`#EXT-X-MAP:URI="init.mp4?t=${play}"`);
    expect(media).toContain(`seg_00000.m4s?t=${play}`);
    const segment = await get(`/v/${VIDEO}/360p/seg_00000.m4s?t=${play}`);
    expect(segment.status).toBe(200);
    expect(new Uint8Array(await segment.arrayBuffer())).toEqual(SEGMENT);
  });

  it("asks the database on every segment, so revocation stops the next one", async () => {
    const play = await sign(pageClaims({ use: "play", exp: NOW + 3600 }));
    expect((await get(`/v/${VIDEO}/360p/seg_00000.m4s?t=${play}`)).status).toBe(200);
    db.sessionLive = false; // sign-out, ban, deletion
    expect((await get(`/v/${VIDEO}/360p/seg_00000.m4s?t=${play}`)).status).toBe(404);
    db.sessionLive = true;
    db.ready = false; // deleted or reprocessing
    expect((await get(`/v/${VIDEO}/360p/seg_00000.m4s?t=${play}`)).status).toBe(404);
    expect(calls.video).toBe(3);
    expect(calls.closed).toBe(3);
  });

  it("serves byte ranges for seeking", async () => {
    const play = await sign(pageClaims({ use: "play", exp: NOW + 3600 }));
    const response = await get(`/v/${VIDEO}/360p/seg_00000.m4s?t=${play}`, { range: "bytes=100-199" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 100-199/1000");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(SEGMENT.slice(100, 200));
    expect((await get(`/v/${VIDEO}/360p/seg_00000.m4s?t=${play}`, { range: "bytes=5000-" })).status).toBe(416);
  });

  it("refuses a ticket for another video, a forged ticket, an image ticket and a second ticket", async () => {
    const other = await sign(pageClaims({ vid: "ea200000-0000-4000-8000-000000000002" }));
    expect((await get(`/v/${VIDEO}/master.m3u8?t=${other}`)).status).toBe(404);
    const good = await sign(pageClaims());
    expect((await get(`/v/${VIDEO}/master.m3u8?t=${good.slice(0, -2)}xx`)).status).toBe(404);
    expect((await get(`/v/${VIDEO}/master.m3u8?t=${vectors.invalid.find((v) => v.reason === "image-ticket prefix")!.ticket}`)).status).toBe(404);
    expect((await get(`/v/${VIDEO}/master.m3u8?t=${good}&t=${good}`)).status).toBe(404);
    expect((await get(`/v/${VIDEO}/master.m3u8?t=${good}&x=1`)).status).toBe(404);
    expect(calls.video).toBe(0);
  });

  it("serves only known files of granted renditions", async () => {
    const play = await sign(pageClaims({ use: "play", exp: NOW + 3600 }));
    for (const path of ["1080p/index.m3u8", "360p/../../other", "original", "360p/seg_1.m4s", "master.m3u8.bak"]) {
      expect((await get(`/v/${VIDEO}/${path}?t=${play}`)).status, path).toBe(404);
    }
  });

  it("is off unless VIDEO_ROUTES is on", async () => {
    env.VIDEO_ROUTES = "off";
    expect((await get(`/v/${VIDEO}/master.m3u8?t=${await sign(pageClaims())}`)).status).toBe(404);
  });
});

describe("public playback", () => {
  it("serves a published video without a ticket and withdraws it on unpublish", async () => {
    db.published = true;
    const master = await get(`/v/${VIDEO}/master.m3u8`, { origin: "https://app.example" });
    expect(master.status).toBe(200);
    expect(master.headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(await master.text()).not.toContain("?t=");
    expect((await get(`/v/${VIDEO}/poster.jpg`)).headers.get("content-type")).toBe("image/jpeg");
    db.published = false;
    expect((await get(`/v/${VIDEO}/360p/seg_00000.m4s`)).status).toBe(404);
    expect(calls.requests.every((r) => r.viewer === null)).toBe(true);
  });

  it("does not reflect origins that are not allowed", async () => {
    db.published = true;
    const response = await get(`/v/${VIDEO}/master.m3u8`, { origin: "https://evil.example" });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect((await get(`/v/${VIDEO}/master.m3u8`, { origin: "https://evil.example", "access-control-request-method": "GET" }, "OPTIONS")).status).toBe(404);
    expect((await get(`/v/${VIDEO}/master.m3u8`, { origin: "https://app.example" }, "OPTIONS")).status).toBe(204);
  });

  it("caches segment bytes by revision, still authorizing every request", async () => {
    db.published = true;
    await (await get(`/v/${VIDEO}/360p/seg_00000.m4s`)).arrayBuffer();
    await Promise.all(waits);
    expect(cacheStore.has(`https://media-edge.internal/${PREFIX}360p/seg_00000.m4s?rev=${REV}`)).toBe(true);
    const hit = await get(`/v/${VIDEO}/360p/seg_00000.m4s`);
    expect(new Uint8Array(await hit.arrayBuffer())).toEqual(SEGMENT);
    db.published = false;
    expect((await get(`/v/${VIDEO}/360p/seg_00000.m4s`)).status).toBe(404);
    expect(calls.video).toBe(3);
  });
});

describe("playlist rewriting", () => {
  it("refuses absolute, parent and unknown URIs", () => {
    expect(rewritePlaylist("#EXTM3U\nhttps://evil.example/x.m4s\n", false, ["360p"], "T")).toBeNull();
    expect(rewritePlaylist("#EXTM3U\n../720p/seg_00000.m4s\n", false, ["360p"], "T")).toBeNull();
    expect(rewritePlaylist("#EXTM3U\n#EXT-X-MAP:URI=\"../x.mp4\"\n", false, ["360p"], "T")).toBeNull();
    expect(rewritePlaylist("#EXTM3U\n1080p/index.m3u8\n", true, ["360p"], "T")).toBeNull();
  });
});
