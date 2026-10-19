import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./media", () => ({ resolveMedia: vi.fn() }));
import vectors from "../../../../edge/media-worker/test/ticket-vectors.json";
// The Worker's own verifier: app-minted tickets must verify there, byte for byte.
import { parseTicketKeys, verifyTicket } from "../../../../edge/media-worker/src/ticket";
import { edgeConfig, mintTicket, privateMediaUrl, publicMediaUrl, publicPortfolioSource, readableMediaUrl, ticketExpiry, type TicketClaims } from "./edge-ticket";
import { resolveMedia } from "./media";
import { storageEnvSchema } from "@/lib/env/storage";
import type { SupabaseClient } from "@supabase/supabase-js";

const workerKeys = parseTicketKeys(JSON.stringify(vectors.keys));
const VIEWER = "70000009-0000-4000-8000-000000000009";
const SESSION = "e9000000-0000-4000-8000-000000000001";
const OTHER = "70000003-0000-4000-8000-000000000003";
const KEY = `${VIEWER}/e9100000-0000-4000-8000-000000000002.pdf`;
const PRODUCT = "9c000000-cccc-4ccc-8ccc-000000000001/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png";
const WS = "9d000000-dddd-4ddd-8ddd-000000000002";

const client = (claims: Record<string, unknown> | null) =>
  ({ auth: { getClaims: vi.fn(async () => (claims ? { data: { claims }, error: null } : { data: null, error: new Error("no session") })) } }) as unknown as SupabaseClient;

function enableEdge(extra: Record<string, string> = {}) {
  vi.stubEnv("MEDIA_EDGE_DELIVERY_ENABLED", "true");
  vi.stubEnv("MEDIA_EDGE_ORIGIN", "https://media.example.test/");
  vi.stubEnv("MEDIA_EDGE_TICKET_KID", "k1");
  vi.stubEnv("MEDIA_EDGE_TICKET_SECRET", vectors.keys.k1);
  for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v);
}
const ticketOf = (url: string) => new URL(url).searchParams.get("t")!;

beforeEach(() => { vi.unstubAllEnvs(); vi.stubEnv("MEDIA_EDGE_DELIVERY_ENABLED", "false"); });
afterEach(() => vi.unstubAllEnvs());

describe("ticket minting (shared vectors with the Worker)", () => {
  it("mints byte-identical tickets to every reference vector", () => {
    for (const v of vectors.valid) {
      const secret = Buffer.from(vectors.keys[v.kid as "k1" | "k2"], "base64url");
      expect(mintTicket(v.kid, secret, v.claims as TicketClaims)).toBe(v.ticket);
    }
  });

  it("app-minted tickets verify in the Worker; tampering, another key or another viewer do not", async () => {
    const claims: TicketClaims = { v: 1, ns: "product", k: PRODUCT, var: "card", sub: VIEWER, sid: SESSION, ws: WS, exp: vectors.now + 90 };
    const ticket = mintTicket("k1", Buffer.from(vectors.keys.k1, "base64url"), claims);
    expect(await verifyTicket(ticket, workerKeys, vectors.now)).toEqual(claims);
    const [kid, , mac] = ticket.split(".");
    const forged = Buffer.from(JSON.stringify({ ...claims, sub: OTHER }), "utf8").toString("base64url");
    expect(await verifyTicket(`${kid}.${forged}.${mac}`, workerKeys, vectors.now)).toBeNull();
    expect(await verifyTicket(mintTicket("k1", Buffer.alloc(32, 9), claims), workerKeys, vectors.now)).toBeNull();
    expect(await verifyTicket(mintTicket("k2", Buffer.from(vectors.keys.k1, "base64url"), claims), workerKeys, vectors.now)).toBeNull();
    expect(await verifyTicket(ticket, workerKeys, claims.exp + 6)).toBeNull();
  });

  it("expires 60-120 s after minting and is stable within one minute", () => {
    for (const now of [1_792_310_400_000, 1_792_310_400_001, 1_792_310_459_999, 1_792_310_430_500]) {
      const ttl = ticketExpiry(now) - now / 1000;
      expect(ttl).toBeGreaterThanOrEqual(60);
      expect(ttl).toBeLessThanOrEqual(120);
    }
    expect(ticketExpiry(1_792_310_400_001)).toBe(ticketExpiry(1_792_310_459_999));
  });
});

describe("URL switch", () => {
  const viewer = { sub: VIEWER, session_id: SESSION, role: "authenticated", exp: vectors.now + 3600 };

  it("flag off: exactly today's application URLs, and no Auth call", async () => {
    const c = client(viewer);
    expect(edgeConfig()).toBeNull();
    expect(await privateMediaUrl(c, "certificate", KEY, "r2")).toBe(`/api/media/certificate?key=${encodeURIComponent(KEY)}`);
    expect(await privateMediaUrl(c, "product", PRODUCT, "r2", { workspace: WS })).toBe(`/api/media/product?key=${encodeURIComponent(PRODUCT)}&workspace=${WS}`);
    expect(publicMediaUrl("portfolio", "e9100000-0000-4000-8000-000000000001", true)).toBe("/p/media/e9100000-0000-4000-8000-000000000001");
    expect(c.auth.getClaims).not.toHaveBeenCalled();
  });

  it("flag on: Supabase-provider rows keep the proxy; R2 rows get a Worker URL with a bound ticket", async () => {
    enableEdge();
    const c = client(viewer);
    expect(await privateMediaUrl(c, "certificate", KEY, "supabase")).toBe(`/api/media/certificate?key=${encodeURIComponent(KEY)}`);
    const now = vectors.now * 1000;
    const url = await privateMediaUrl(c, "product", PRODUCT, "r2", { workspace: WS, nowMs: now });
    expect(url.startsWith("https://media.example.test/m/product/original?t=")).toBe(true);
    expect(await verifyTicket(ticketOf(url), workerKeys, vectors.now)).toEqual(
      { v: 1, ns: "product", k: PRODUCT, var: "original", sub: VIEWER, sid: SESSION, ws: WS, exp: ticketExpiry(now) });
    const personal = await privateMediaUrl(c, "certificate", KEY, "r2", { workspace: WS, nowMs: now });
    expect((await verifyTicket(ticketOf(personal), workerKeys, vectors.now))?.ws).toBeNull();
  });

  it("flag on without a verified session falls back to the proxy (which then refuses)", async () => {
    enableEdge();
    expect(await privateMediaUrl(client(null), "certificate", KEY, "r2")).toBe(`/api/media/certificate?key=${encodeURIComponent(KEY)}`);
    expect(await privateMediaUrl(client({ sub: VIEWER, role: "authenticated", exp: vectors.now + 3600 }), "certificate", KEY, "r2")).toBe(`/api/media/certificate?key=${encodeURIComponent(KEY)}`);
  });

  it("public URLs carry only the opaque id, and Mode C can be held back", () => {
    enableEdge();
    expect(publicMediaUrl("portfolio", "e9100000-0000-4000-8000-000000000001", true)).toBe("/p/media/e9100000-0000-4000-8000-000000000001");
    vi.stubEnv("MEDIA_EDGE_PUBLIC_ENABLED", "true");
    expect(publicMediaUrl("portfolio", "e9100000-0000-4000-8000-000000000001", true)).toBe("https://media.example.test/c/portfolio/e9100000-0000-4000-8000-000000000001/original");
    expect(publicMediaUrl("portfolio", "e9100000-0000-4000-8000-000000000001", false)).toBe("/p/media/e9100000-0000-4000-8000-000000000001");
    vi.stubEnv("MEDIA_EDGE_PUBLIC_ENABLED", "false");
    expect(publicMediaUrl("portfolio", "e9100000-0000-4000-8000-000000000001", true)).toBe("/p/media/e9100000-0000-4000-8000-000000000001");
  });

  it("public sources offer only recorded variants, and only through the Worker", () => {
    const id = "e9100000-0000-4000-8000-000000000001";
    expect(publicPortfolioSource(id, ["thumb", "card"])).toEqual({ src: `/p/media/${id}` });
    enableEdge({ MEDIA_EDGE_PUBLIC_ENABLED: "true" });
    expect(publicPortfolioSource(id, undefined)).toEqual({ src: `/p/media/${id}` });
    expect(publicPortfolioSource(id, [])).toEqual({ src: `https://media.example.test/c/portfolio/${id}/original` });
    expect(publicPortfolioSource(id, ["thumb", "card"])).toEqual({ src: `https://media.example.test/c/portfolio/${id}/original`,
      variants: { thumb: `https://media.example.test/c/portfolio/${id}/thumb`, card: `https://media.example.test/c/portfolio/${id}/card` } });
  });

  it("readableMediaUrl keeps readMediaUrl's ownership rule before minting", async () => {
    enableEdge();
    vi.mocked(resolveMedia).mockResolvedValueOnce({ provider: "r2", contentType: "application/pdf", reserved: true, state: "ready", owner: null });
    await expect(readableMediaUrl(client(viewer), "certificate", KEY)).rejects.toThrow();
    vi.mocked(resolveMedia).mockResolvedValueOnce({ provider: "r2", contentType: "application/pdf", reserved: true, state: "ready", owner: VIEWER });
    expect(await readableMediaUrl(client(viewer), "certificate", KEY)).toMatch(/^https:\/\/media\.example\.test\/m\/certificate\/original\?t=k1\./);
  });
});

describe("edge settings fail fast only when enabled", () => {
  const on = { MEDIA_EDGE_DELIVERY_ENABLED: "true", MEDIA_EDGE_ORIGIN: "https://media.example.test", MEDIA_EDGE_TICKET_KID: "k1", MEDIA_EDGE_TICKET_SECRET: vectors.keys.k1 };
  it("defaults off with nothing configured", () => {
    expect(storageEnvSchema.parse({}).MEDIA_EDGE_DELIVERY_ENABLED).toBe(false);
  });
  it("accepts a complete configuration", () => {
    expect(storageEnvSchema.parse(on).MEDIA_EDGE_DELIVERY_ENABLED).toBe(true);
  });
  it.each([
    ["missing secret", { MEDIA_EDGE_TICKET_SECRET: "" }],
    ["short secret", { MEDIA_EDGE_TICKET_SECRET: "c2hvcnQ" }],
    ["missing kid", { MEDIA_EDGE_TICKET_KID: "" }],
    ["http origin", { MEDIA_EDGE_ORIGIN: "http://media.example.test" }],
    ["origin with path", { MEDIA_EDGE_ORIGIN: "https://media.example.test/m" }],
  ])("refuses %s", (_, change) => {
    expect(() => storageEnvSchema.parse({ ...on, ...change })).toThrow();
  });
});
