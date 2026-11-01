import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({ readSessionIdentity: vi.fn() }));
vi.mock("@/server/storage/media", () => ({ resolveMedia: vi.fn() }));
import vectors from "../../../../edge/media-worker/test/view-as-ticket-vectors.json";
import ownerVectors from "../../../../edge/media-worker/test/ticket-vectors.json";
// The Worker's own verifier: app-minted tickets must verify there, byte for byte.
import { parseTicketKeys } from "../../../../edge/media-worker/src/ticket";
import { verifyViewAsTicket } from "../../../../edge/media-worker/src/view-as-ticket";
import { mintViewAsTicket, viewAsMediaUrl, viewAsTicketExpiry, type ViewAsTicketClaims } from "./media-ticket";
import { ticketExpiry } from "@/server/storage/edge-ticket";
import { readSessionIdentity } from "@/server/auth/session";
import { readViewAsEdgeConfig } from "@/lib/env/view-as";
import { storageEnvSchema } from "@/lib/env/storage";
import type { SupabaseClient } from "@supabase/supabase-js";

const keys = parseTicketKeys(JSON.stringify(vectors.keys));
const ADMIN = "55555555-5555-4555-8555-555555555555";
const SESSION = "ea000000-0000-4000-8000-000000000001";
const SUBJECT = "71000006-0000-4000-8000-000000000006";
const RECORD = "ea300000-0000-4000-8000-000000000001";
const client = {} as SupabaseClient;

function enable(extra: Record<string, string> = {}) {
  vi.stubEnv("ADMIN_VIEW_AS_ENABLED", "true");
  vi.stubEnv("ADMIN_VIEW_AS_MEDIA_ENABLED", "true");
  vi.stubEnv("MEDIA_EDGE_DELIVERY_ENABLED", "true");
  vi.stubEnv("MEDIA_EDGE_ORIGIN", "https://media.example.test/");
  vi.stubEnv("MEDIA_EDGE_TICKET_KID", "k1");
  vi.stubEnv("MEDIA_EDGE_TICKET_SECRET", vectors.keys.k1);
  for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v);
}
const ticketOf = (url: string) => new URL(url).searchParams.get("t")!;

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(readSessionIdentity).mockResolvedValue({ id: ADMIN, sessionId: SESSION } as never);
});
afterEach(() => vi.unstubAllEnvs());

describe("View-As ticket minting (shared vectors with the Worker)", () => {
  it("mints byte-identical tickets to every reference vector", async () => {
    for (const v of vectors.valid) {
      expect(await mintViewAsTicket(v.kid, new Uint8Array(Buffer.from(vectors.keys.k1, "base64url")), v.claims as ViewAsTicketClaims)).toBe(v.ticket);
    }
  });

  it("verifies in the Worker; the owner verifier and a different key do not accept it", async () => {
    const claims: ViewAsTicketClaims = { v: 1, kind: "certificate", rid: RECORD, var: "original", adm: ADMIN, sid: SESSION, subj: SUBJECT, exp: vectors.now + 90 };
    const ticket = await mintViewAsTicket("k1", new Uint8Array(Buffer.from(vectors.keys.k1, "base64url")), claims);
    expect(await verifyViewAsTicket(ticket, keys, vectors.now)).toEqual(claims);
    const { verifyTicket } = await import("../../../../edge/media-worker/src/ticket");
    expect(await verifyTicket(ticket, parseTicketKeys(JSON.stringify(ownerVectors.keys)), vectors.now)).toBeNull();
    expect(await verifyViewAsTicket(ticket.replace(/^k1/, "k2"), keys, vectors.now)).toBeNull();
  });

  it("uses the same expiry rule as the owner path (the two copies cannot drift)", () => {
    for (const now of [0, 1, 59_999, 60_000, 1_792_310_400_123, 1_792_310_459_999]) expect(viewAsTicketExpiry(now)).toBe(ticketExpiry(now));
  });
});

describe("View-As edge settings (a minimal reader, equal to the owner schema's rules)", () => {
  const good = { MEDIA_EDGE_DELIVERY_ENABLED: "true", MEDIA_EDGE_ORIGIN: "https://media.example.test", MEDIA_EDGE_TICKET_KID: "k1", MEDIA_EDGE_TICKET_SECRET: vectors.keys.k1 };
  const ownerAccepts = (over: Record<string, string>) =>
    storageEnvSchema.safeParse({ ...good, ...over }).success;
  const stub = (over: Record<string, string>) => { vi.unstubAllEnvs(); for (const [k, v] of Object.entries({ ...good, ...over })) vi.stubEnv(k, v); };

  it.each<[string, Record<string, string>]>([
    ["a valid configuration", {}],
    ["delivery switched off", { MEDIA_EDGE_DELIVERY_ENABLED: "false" }],
    ["an http origin", { MEDIA_EDGE_ORIGIN: "http://media.example.test" }],
    ["an origin with a path", { MEDIA_EDGE_ORIGIN: "https://media.example.test/x" }],
    ["an uppercase key id", { MEDIA_EDGE_TICKET_KID: "K1" }],
    ["a missing secret", { MEDIA_EDGE_TICKET_SECRET: "" }],
    ["a short secret", { MEDIA_EDGE_TICKET_SECRET: "AAECAwQ" }],
  ])("agrees with the owner schema on %s (configured only when the owner schema also accepts it)", (_n, over) => {
    stub(over);
    const configured = readViewAsEdgeConfig() !== null;
    const delivering = (over.MEDIA_EDGE_DELIVERY_ENABLED ?? "true") === "true";
    expect(configured).toBe(delivering && ownerAccepts(over));
  });

  it("reads nothing but the four MEDIA_EDGE settings (no service-role key, no storage secret)", async () => {
    const src = (await import("node:fs")).readFileSync(new URL("../../lib/env/view-as.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/SERVICE_ROLE|R2_|SECRET_ACCESS|process\.env\.(?!ADMIN_VIEW_AS|MEDIA_EDGE)/);
  });
});

describe("viewAsMediaUrl", () => {
  it("is OFF by default: no URL, so the page keeps its placeholder", async () => {
    expect(await viewAsMediaUrl(client, SUBJECT, "portfolio_item", RECORD)).toBeNull();
  });

  it("needs BOTH switches and edge delivery: each missing one gives null (never a fallback URL)", async () => {
    enable({ ADMIN_VIEW_AS_MEDIA_ENABLED: "false" });
    expect(await viewAsMediaUrl(client, SUBJECT, "portfolio_item", RECORD)).toBeNull();
    vi.unstubAllEnvs(); enable({ ADMIN_VIEW_AS_ENABLED: "false" });
    expect(await viewAsMediaUrl(client, SUBJECT, "portfolio_item", RECORD)).toBeNull();
    vi.unstubAllEnvs(); enable({ MEDIA_EDGE_DELIVERY_ENABLED: "false" });
    expect(await viewAsMediaUrl(client, SUBJECT, "portfolio_item", RECORD)).toBeNull();
  });

  it("returns an edge /a URL whose ticket names records and accounts only, never a key, path or file name", async () => {
    enable();
    const url = (await viewAsMediaUrl(client, SUBJECT, "portfolio_item", RECORD, { nowMs: vectors.now * 1000 }))!;
    expect(url.startsWith("https://media.example.test/a/portfolio_item/original?t=")).toBe(true);
    const payload = Buffer.from(ticketOf(url).split(".")[1]!, "base64url").toString("utf8");
    expect(JSON.parse(payload)).toEqual({ v: 1, kind: "portfolio_item", rid: RECORD, var: "original", adm: ADMIN, sid: SESSION, subj: SUBJECT,
      exp: viewAsTicketExpiry(vectors.now * 1000) });
    expect(payload).not.toMatch(/\.(jpg|jpeg|png|webp|pdf)|portfolio\/|certificate\/|object|path/i);
    expect(url).not.toContain("/m/");
    expect(await verifyViewAsTicket(ticketOf(url), keys, vectors.now)).not.toBeNull();
  });

  it("lives at most 120 s", async () => {
    enable();
    const now = vectors.now * 1000;
    const url = (await viewAsMediaUrl(client, SUBJECT, "avatar", RECORD, { nowMs: now, variant: "thumb" }))!;
    const claims = (await verifyViewAsTicket(ticketOf(url), keys, vectors.now))!;
    expect(claims.exp - vectors.now).toBeGreaterThan(0);
    expect(claims.exp - vectors.now).toBeLessThanOrEqual(120);
  });

  it.each([
    ["no session", null],
    ["a session with no id", { id: ADMIN, sessionId: null }],
    ["the viewer is the subject", { id: SUBJECT, sessionId: SESSION }],
    ["a malformed viewer id", { id: "nope", sessionId: SESSION }],
  ])("returns null for %s", async (_n, identity) => {
    enable();
    vi.mocked(readSessionIdentity).mockResolvedValue(identity as never);
    expect(await viewAsMediaUrl(client, SUBJECT, "portfolio_item", RECORD)).toBeNull();
  });

  it("returns null for a malformed subject or record id", async () => {
    enable();
    expect(await viewAsMediaUrl(client, "x", "portfolio_item", RECORD)).toBeNull();
    expect(await viewAsMediaUrl(client, SUBJECT, "portfolio_item", "../etc")).toBeNull();
  });
});
