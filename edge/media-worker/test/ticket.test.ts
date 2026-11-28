import { describe, expect, it } from "vitest";
import vectors from "./ticket-vectors.json";
import { parseTicketKeys, signTicket, verifyTicket, type TicketClaims } from "../src/ticket";

const keys = parseTicketKeys(JSON.stringify(vectors.keys));
const valid = vectors.valid as { kid: string; claims: TicketClaims; ticket: string }[];

describe("ticket v1 (shared vectors)", () => {
  it("signs byte-identically to the reference vectors", async () => {
    for (const v of valid) expect(await signTicket(v.kid, keys.get(v.kid)!, v.claims)).toBe(v.ticket);
  });

  it("verifies every valid vector to its exact claims", async () => {
    for (const v of valid) expect(await verifyTicket(v.ticket, keys, vectors.now)).toEqual(v.claims);
  });

  it.each(vectors.invalid)("rejects: $why", async ({ ticket }) => {
    expect(await verifyTicket(ticket, keys, vectors.now)).toBeNull();
  });

  it("enforces expiry with a 5 s skew and a 120 s maximum lifetime", async () => {
    const v = valid[1]!; // exp = now + 60
    expect(await verifyTicket(v.ticket, keys, v.claims.exp + 5)).not.toBeNull();
    expect(await verifyTicket(v.ticket, keys, v.claims.exp + 6)).toBeNull();
    const long = await signTicket("k1", keys.get("k1")!, { ...v.claims, exp: vectors.now + 600 });
    expect(await verifyTicket(long, keys, vectors.now)).toBeNull();
  });

  it("supports rotation: a retired key id stops verifying", async () => {
    const k2 = valid[2]!;
    expect(await verifyTicket(k2.ticket, keys, vectors.now)).not.toBeNull();
    const onlyK1 = parseTicketKeys(JSON.stringify({ k1: vectors.keys.k1 }));
    expect(await verifyTicket(k2.ticket, onlyK1, vectors.now)).toBeNull();
  });

  it("rejects claims outside the closed shape even when correctly signed", async () => {
    const base = valid[1]!.claims;
    const bad: Record<string, unknown>[] = [
      { ...base, ws: "9d000000-dddd-4ddd-8ddd-000000000002" }, // workspace on personal media
      { ...base, k: "../../etc/passwd" },
      { ...base, var: "raw" },
      { ...base, ns: "business-verification" },
      { ...base, sub: "not-a-uuid" },
      { ...base, v: 2 },
    ];
    for (const claims of bad) {
      const ticket = await signTicket("k1", keys.get("k1")!, claims as TicketClaims);
      expect(await verifyTicket(ticket, keys, vectors.now)).toBeNull();
    }
  });

  it("refuses weak or malformed key material", () => {
    expect(() => parseTicketKeys(JSON.stringify({ k1: "c2hvcnQ" }))).toThrow();
    expect(() => parseTicketKeys(JSON.stringify({ "K!": vectors.keys.k1 }))).toThrow();
    expect(() => parseTicketKeys("{}")).toThrow();
  });
});
