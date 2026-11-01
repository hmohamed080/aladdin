import { beforeEach, describe, expect, it } from "vitest";
import vectors from "./view-as-ticket-vectors.json";
import ownerVectors from "./ticket-vectors.json";
import { createHandler } from "../src/handler";
import { parseTicketKeys, signTicket } from "../src/ticket";
import { signViewAsTicket, verifyViewAsTicket, VIEW_AS_TICKET_PREFIX, type ViewAsClaims } from "../src/view-as-ticket";
import type { Env, MediaAuthority, R2BucketLike } from "../src/types";

const NOW = vectors.now;
const keys = parseTicketKeys(JSON.stringify(vectors.keys));
const ADMIN = "55555555-5555-4555-8555-555555555555";
const SESSION = "ea000000-0000-4000-8000-000000000001";
const SUBJECT = "71000006-0000-4000-8000-000000000006";
const ITEM = "ea300000-0000-4000-8000-000000000001";
const OBJECT = "portfolio/ea400000-0000-4000-8000-000000000001.jpg";
const BYTES = new TextEncoder().encode("private portfolio bytes");
const SHA = "c".repeat(64);

/** In-memory stand-in for the database; each test flips ONE thing, so a denial is attributable to one cause. */
type Db = { viewLive: boolean; sessionAlive: boolean; permitted: boolean; ownedBySubject: boolean };
let db: Db;
let seen: unknown[];
let closed: number;

function fakeAuthority(): MediaAuthority {
  return {
    async authorizePrivate() { throw new Error("the owner path must not be used by /a"); },
    async authorizePublic() { throw new Error("the public path must not be used by /a"); },
    async authorizeVideo() { throw new Error("the video path must not be used by /a"); },
    async authorizeViewAs(r) {
      seen.push(r);
      // Mirrors public.media_edge_view_as_authorize: every request re-checks all of these.
      if (!db.permitted || !db.sessionAlive || !db.viewLive || !db.ownedBySubject) return null;
      if (r.admin !== ADMIN || r.session !== SESSION || r.subject !== SUBJECT || r.record !== ITEM || r.expiresAt < NOW - 5) return null;
      return { object: OBJECT, contentType: "image/jpeg", size: BYTES.length, sha256: SHA };
    },
    async close() { closed++; },
  };
}

const bucket: R2BucketLike = {
  async get(key) { return key === OBJECT ? { size: BYTES.length, body: new Blob([BYTES]).stream() } : null; },
  async head(key) { return key === OBJECT ? { size: BYTES.length } : null; },
};
const waits: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => { waits.push(p); } };
const handle = createHandler({ authority: () => fakeAuthority(), now: () => NOW * 1000 });
let env: Env;

beforeEach(() => {
  db = { viewLive: true, sessionAlive: true, permitted: true, ownedBySubject: true };
  seen = []; closed = 0;
  env = { MEDIA_BUCKET: bucket, HYPERDRIVE: { connectionString: "postgres://unused" }, TICKET_KEYS: JSON.stringify(vectors.keys), VIEW_AS_ROUTES: "on" };
});

const claims = (over: Partial<ViewAsClaims> = {}): ViewAsClaims =>
  ({ v: 1, kind: "portfolio_item", rid: ITEM, var: "original", adm: ADMIN, sid: SESSION, subj: SUBJECT, exp: NOW + 90, ...over });
const secret = keys.get("k1")!;
async function url(over: Partial<ViewAsClaims> = {}, path = "/a/portfolio_item/original") {
  return `https://media.test${path}?t=${await signViewAsTicket("k1", secret, claims(over))}`;
}
const get = async (u: string, init?: RequestInit) => { const r = await handle(new Request(u, init), env, ctx); await Promise.all(waits.splice(0)); return r; };

describe("View-As ticket", () => {
  it("matches the pinned cross-language vectors byte for byte", async () => {
    for (const v of vectors.valid) {
      expect(await signViewAsTicket(v.kid, keys.get(v.kid)!, v.claims as ViewAsClaims)).toBe(v.ticket);
      expect(await verifyViewAsTicket(v.ticket, keys, NOW)).toEqual(v.claims);
    }
  });

  it("carries only opaque record ids: no storage key, path or file name can be decoded from it", async () => {
    const ticket = await signViewAsTicket("k1", secret, claims());
    const decoded = Buffer.from(ticket.split(".")[1]!, "base64url").toString("utf8");
    expect(decoded).not.toMatch(/portfolio\/|\.jpg|\.pdf|\.png|object|key|path|certificate\//i);
    expect(Object.keys(JSON.parse(decoded)).sort()).toEqual(["adm", "exp", "kind", "rid", "sid", "subj", "var", "v"].sort());
  });

  it("is domain-separated: an owner ticket is not a View-As ticket and the reverse", async () => {
    const ownerKeys = parseTicketKeys(JSON.stringify(ownerVectors.keys));
    const owner = await signTicket("k1", ownerKeys.get("k1")!, { v: 1, ns: "portfolio", k: "ea400000-0000-4000-8000-000000000001.jpg", var: "original", sub: ADMIN, sid: SESSION, ws: null, exp: NOW + 90 });
    expect(await verifyViewAsTicket(owner, parseTicketKeys(JSON.stringify(ownerVectors.keys)), NOW)).toBeNull();
    expect(VIEW_AS_TICKET_PREFIX).not.toBe("aladdin.media-edge.v1.");
    const va = await signViewAsTicket("k1", secret, claims());
    env.PRIVATE_ROUTES = "on";
    const r = await get(`https://media.test/m/portfolio/original?t=${va}`);
    expect(r.status).toBe(404);
  });

  it.each([
    ["an unknown kind", { kind: "product" as never }],
    ["an unknown variant", { var: "huge" as never }],
    ["a non-uuid record", { rid: "not-a-uuid" }],
    ["the admin as their own subject", { subj: ADMIN }],
  ])("rejects %s", async (_n, over) => {
    const ticket = await signViewAsTicket("k1", secret, { ...claims(), ...over } as ViewAsClaims);
    expect(await verifyViewAsTicket(ticket, keys, NOW)).toBeNull();
  });

  it("rejects a correctly SIGNED payload that carries an extra or missing claim (strict schema)", async () => {
    const forge = async (obj: Record<string, unknown>) => {
      const payload = Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
      const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const mac = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${VIEW_AS_TICKET_PREFIX}k1.${payload}`))).toString("base64url");
      return `k1.${payload}.${mac}`;
    };
    const ok = { ...claims() };
    expect(await verifyViewAsTicket(await forge(ok), keys, NOW)).not.toBeNull(); // the forge itself is correct
    expect(await verifyViewAsTicket(await forge({ ...ok, key: "portfolio/secret.jpg" }), keys, NOW)).toBeNull();
    const { adm: _adm, ...missing } = ok;
    expect(await verifyViewAsTicket(await forge(missing), keys, NOW)).toBeNull();
  });

  it("rejects an expired ticket, one longer than 120 s, and a tampered one", async () => {
    expect(await verifyViewAsTicket(await signViewAsTicket("k1", secret, claims({ exp: NOW - 10 })), keys, NOW)).toBeNull();
    expect(await verifyViewAsTicket(await signViewAsTicket("k1", secret, claims({ exp: NOW + 600 })), keys, NOW)).toBeNull();
    const t = await signViewAsTicket("k1", secret, claims());
    const [kid, p, m] = t.split(".");
    expect(await verifyViewAsTicket(`${kid}.${p}x.${m}`, keys, NOW)).toBeNull();
    expect(await verifyViewAsTicket(`${kid}.${p}.${m!.slice(0, -2)}AA`, keys, NOW)).toBeNull();
    expect(await verifyViewAsTicket("k2." + t.split(".").slice(1).join("."), keys, NOW)).toBeNull();
  });
});

describe("/a route (Admin View-As private media)", () => {
  it("is OFF by default: with the flag unset the route does not exist and the database is never asked", async () => {
    delete env.VIEW_AS_ROUTES;
    const r = await get(await url());
    expect(r.status).toBe(404);
    expect(seen).toHaveLength(0);
  });

  it("serves the bytes with private, no-store headers and no object key in the response", async () => {
    const r = await get(await url());
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("private portfolio bytes");
    expect(r.headers.get("cache-control")).toMatch(/private/);
    expect(r.headers.get("cache-control")).toMatch(/no-store/);
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(JSON.stringify([...r.headers.entries()])).not.toContain("ea400000");
    expect(seen).toEqual([{ kind: "portfolio_item", record: ITEM, variant: "original", admin: ADMIN, session: SESSION, subject: SUBJECT, expiresAt: NOW + 90 }]);
    expect(closed).toBe(1);
  });

  it("asks the database on EVERY request (nothing about authorization is cached)", async () => {
    await get(await url()); await get(await url()); await get(await url());
    expect(seen).toHaveLength(3);
  });

  it.each([
    ["the view session ended (Exit, expiry, rank change)", { viewLive: false }],
    ["the Admin signed out or the Auth session ended", { sessionAlive: false }],
    ["the Admin lost users.view_as", { permitted: false }],
    ["the object is not owned by the viewed account", { ownedBySubject: false }],
  ] as const)("is refused on the very next request once %s", async (_n, change) => {
    expect((await get(await url())).status).toBe(200);
    Object.assign(db, change);
    const r = await get(await url());
    expect(r.status).toBe(404);
    expect(await r.text()).toBe("");
  });

  it("answers identically (404, empty) for malformed, mismatched, expired and denied requests: no existence oracle", async () => {
    const bad = [
      `https://media.test/a/portfolio_item/original`,
      `https://media.test/a/portfolio_item/original?t=garbage`,
      `https://media.test/a/portfolio_item/original?t=a&t=b`,
      `https://media.test/a/portfolio_item/original?t=x&extra=1`,
      await url({}, "/a/certificate/original"),
      await url({}, "/a/portfolio_item/thumb"),
      await url({ exp: NOW - 60 }),
      await url({ rid: "ea300000-0000-4000-8000-0000000000ff" }),
      await url({ adm: "22222222-2222-4222-8222-222222222222" }),
      await url({ sid: "ea000000-0000-4000-8000-0000000000ff" }),
      await url({ subj: "71000007-0000-4000-8000-000000000007" }),
    ];
    for (const u of bad) {
      const r = await get(u);
      expect(r.status).toBe(404);
      expect(await r.text()).toBe("");
    }
  });

  it("refuses a grant whose object is outside the ticket kind's namespace", async () => {
    const orig = fakeAuthority;
    const h = createHandler({ now: () => NOW * 1000, authority: () => ({ ...orig(), authorizeViewAs: async () => ({ object: "certificate/x.pdf", contentType: "application/pdf", size: 4, sha256: SHA }) }) });
    const r = await h(new Request(await url()), env, ctx);
    expect(r.status).toBe(404);
  });

  it("only answers GET and HEAD", async () => {
    expect((await get(await url(), { method: "POST" })).status).toBe(404);
    expect((await get(await url(), { method: "HEAD" })).status).toBe(200);
  });
});
