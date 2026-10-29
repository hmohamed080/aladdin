import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { candidateMacs, computeMac, generateCode, ipBucketKey, issueMac, newChallengeId, parseKeyring } from "./otp";

const b64 = (n = 32) => randomBytes(n).toString("base64");
const ring = (extra: Record<string, string> = {}, current = "k2") =>
  parseKeyring(JSON.stringify({ current, keys: { k2: b64(), ...extra } }));
const ctx = { challengeId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", purpose: "primary_proof" as const };

describe("parseKeyring", () => {
  it("accepts 1..3 keys of at least 32 bytes and a current key that exists", () => {
    const r = ring({ k1: b64(), k0: b64(48) });
    expect([...r.keys.keys()].sort()).toEqual(["k0", "k1", "k2"]);
    expect(r.current).toBe("k2");
  });

  it.each([
    ["missing", undefined],
    ["not json", "{nope"],
    ["no keys", JSON.stringify({ current: "a", keys: {} })],
    ["current not in keys", JSON.stringify({ current: "zz", keys: { a: b64() } })],
    ["short key", JSON.stringify({ current: "a", keys: { a: randomBytes(16).toString("base64") } })],
    ["bad kid", JSON.stringify({ current: "a b", keys: { "a b": b64() } })],
    ["four keys", JSON.stringify({ current: "a", keys: { a: b64(), b: b64(), c: b64(), d: b64() } })],
  ])("rejects %s without echoing key material", (_name, raw) => {
    let message = "";
    try {
      parseKeyring(raw as string | undefined);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toMatch(/[A-Za-z0-9+/]{40,}/);
  });
});

describe("one-time code", () => {
  it("is always six digits", () => {
    for (let i = 0; i < 2000; i += 1) expect(generateCode()).toMatch(/^[0-9]{6}$/);
  });
  it("challenge ids are unique v4 uuids", () => {
    const ids = new Set(Array.from({ length: 200 }, newChallengeId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("MAC", () => {
  const key = Buffer.alloc(32, 7);
  it("is deterministic 64-hex and never contains the code or the key", () => {
    const mac = computeMac(key, ctx, "123456");
    expect(mac).toMatch(/^[0-9a-f]{64}$/);
    expect(computeMac(key, ctx, "123456")).toBe(mac);
    expect(mac).not.toContain("123456");
  });
  it("binds to code, challenge, account and key", () => {
    const base = computeMac(key, ctx, "123456");
    expect(computeMac(key, ctx, "123457")).not.toBe(base);
    expect(computeMac(key, { ...ctx, challengeId: "33333333-3333-4333-8333-333333333333" }, "123456")).not.toBe(base);
    expect(computeMac(key, { ...ctx, userId: "33333333-3333-4333-8333-333333333333" }, "123456")).not.toBe(base);
    expect(computeMac(Buffer.alloc(32, 8), ctx, "123456")).not.toBe(base);
  });
  it("is injective by construction: ids that are not UUIDs, or a non-digit code, are refused rather than encoded", () => {
    const u = "33333333-3333-4333-8333-333333333333";
    expect(() => computeMac(key, { challengeId: "a|b", userId: "c", purpose: "primary_proof" }, "1")).toThrow("invalid MAC context");
    expect(() => computeMac(key, { challengeId: u, userId: "b|c", purpose: "primary_proof" }, "1")).toThrow("invalid MAC context");
    expect(() => computeMac(key, { challengeId: u, userId: u, purpose: "primary_proof" }, "12|34")).toThrow("invalid MAC context");
    expect(() => computeMac(key, { challengeId: u, userId: u, purpose: "other" as "primary_proof" }, "1")).toThrow("invalid MAC context");
  });
  it("supports rotation: candidates cover every accepted kid and the issued kid is current", () => {
    const r = ring({ k1: b64() });
    const issued = issueMac(r, ctx, "000042");
    const candidates = candidateMacs(r, ctx, "000042");
    expect(Object.keys(candidates).sort()).toEqual(["k1", "k2"]);
    expect(issued.kid).toBe("k2");
    expect(candidates[issued.kid]).toBe(issued.mac);
    expect(candidates.k1).not.toBe(candidates.k2);
  });
  it("a retired key yields no candidate for the old kid", () => {
    const oldRing = parseKeyring(JSON.stringify({ current: "k1", keys: { k1: b64() } }));
    const issuedUnderOld = issueMac(oldRing, ctx, "000042");
    const after = parseKeyring(JSON.stringify({ current: "k2", keys: { k2: b64() } }));
    expect(candidateMacs(after, ctx, "000042")[issuedUnderOld.kid]).toBeUndefined();
  });
});

describe("ipBucketKey", () => {
  it("is a non-reversible 64-hex digest that does not contain the address", () => {
    const r = ring();
    const k = ipBucketKey(r, "203.0.113.9");
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(ipBucketKey(r, "203.0.113.9")).toBe(k);
    expect(ipBucketKey(r, "203.0.113.10")).not.toBe(k);
    expect(ipBucketKey(r, null)).toBe(ipBucketKey(r, ""));
  });
  it("is domain-separated from the OTP MAC", () => {
    const r = ring();
    expect(ipBucketKey(r, "123456")).not.toBe(computeMac(r.keys.get("k2")!, ctx, "123456"));
  });
});
