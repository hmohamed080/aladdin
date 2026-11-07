import { describe, expect, it, vi } from "vitest";
import { type AttestDeps, attestationCanonical, handleAttest, parseAttestBody, switchMatches } from "./attest";
import { signBody } from "./signing";

const SECRET = "whsec_" + Buffer.alloc(32, 55).toString("base64");
const NONCE = "ab".repeat(16);
const NOW_S = 1_800_000_000;
const ACTOR = "11111111-1111-4111-8111-111111111111";
const ROW = { request_id: "22222222-2222-4222-8222-222222222222", actor: ACTOR, version: 1, at: NOW_S - 100, new: true };

const body = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ source_env: "acceptance", nonce: NONCE, switch: { enabled: true, version: 1, updated_at: NOW_S - 100 }, audit: [ROW], drift: null, ...over });

function request(raw: string, over: { id?: string; secret?: string; stamp?: number; type?: string; method?: string } = {}) {
  const id = over.id ?? `att_${NONCE}`;
  const stamp = over.stamp ?? NOW_S;
  return new Request("https://app.test/api/internal/whatsapp-otp/delivery-attest", {
    method: over.method ?? "POST",
    headers: { "content-type": over.type ?? "application/json", "webhook-id": id, "webhook-timestamp": String(stamp), "webhook-signature": signBody(over.secret ?? SECRET, id, stamp, raw)! },
    body: over.method === "GET" ? undefined : raw,
  });
}

function deps(over: Partial<AttestDeps> = {}) {
  const reconcile = vi.fn(async () => true);
  const authorized = vi.fn(async () => ({ enabled: true, version: 1 }));
  return { reconcile, authorized, d: { secret: SECRET, expectedSourceEnv: "acceptance", reconcile, authorized, now: () => NOW_S * 1000, ...over } as AttestDeps };
}

describe("delivery attestation endpoint", () => {
  it("answers the authorized state, signed over exactly the Worker's nonce and this app's environment", async () => {
    const { d, reconcile, authorized } = deps();
    const res = await handleAttest(request(body()), d);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out).toMatchObject({ authorized: { enabled: true, version: 1 }, issued_at: NOW_S, nonce: NONCE, match: true });
    expect(out.mac).toBe(signBody(SECRET, "attest", NOW_S, "v1a|acceptance|1|1|1800000000|" + NONCE));
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith([ROW], null);
    expect(authorized).toHaveBeenCalledTimes(1);
  });

  it("the canonical string is byte-identical to the Worker's (v1a|env|enabled|version|issued_at|nonce)", () => {
    expect(attestationCanonical({ env: "production", enabled: false, version: 7, issuedAt: 1700000001, nonce: NONCE })).toBe(`v1a|production|0|7|1700000001|${NONCE}`);
  });

  it("a mismatch (forged ON, rolled-back version, deleted row) raises the unmatched alert and answers what is AUTHORIZED, never what D1 claims", async () => {
    const { d, reconcile } = deps({ authorized: async () => ({ enabled: false, version: 2 }) });
    const res = await handleAttest(request(body({ switch: { enabled: true, version: 9, updated_at: 1_799_999_000 } })), d);
    const out = await res.json();
    expect(out.authorized).toEqual({ enabled: false, version: 2 });
    expect(out.match).toBe(false);
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(reconcile).toHaveBeenLastCalledWith([], { version: 9, at: 1_799_999_000 });
  });

  it("a switch with an implausible time is alerted per hour, not per minute", async () => {
    const { d, reconcile } = deps({ authorized: async () => ({ enabled: false, version: 0 }) });
    await handleAttest(request(body({ switch: { enabled: true, version: 5, updated_at: 0 } })), d);
    expect(reconcile).toHaveBeenLastCalledWith([], { version: 5, at: Math.floor(NOW_S / 3600) * 3600 });
  });

  it("no switch row and nothing authorized is a match; no switch row while ON is authorized is not", () => {
    expect(switchMatches(null, { enabled: false, version: 0 })).toBe(true);
    expect(switchMatches(null, { enabled: true, version: 3 })).toBe(false);
    expect(switchMatches({ enabled: true, version: 3, updatedAt: 1 }, { enabled: true, version: 3 })).toBe(true);
    expect(switchMatches({ enabled: true, version: 2, updatedAt: 1 }, { enabled: true, version: 3 })).toBe(false);
  });

  it("the Worker's own drift report reaches reconcile", async () => {
    const { d, reconcile } = deps();
    await handleAttest(request(body({ drift: { version: 4, at: 1_799_000_000 } })), d);
    expect(reconcile).toHaveBeenCalledWith([ROW], { version: 4, at: 1_799_000_000 });
  });

  it("authenticates before anything: bad signature, stale clock, wrong secret touch no state", async () => {
    const { d, reconcile, authorized } = deps();
    expect((await handleAttest(request(body(), { secret: "whsec_" + Buffer.alloc(32, 1).toString("base64") }), d)).status).toBe(401);
    expect((await handleAttest(request(body(), { stamp: NOW_S - 400 }), d)).status).toBe(401);
    expect(reconcile).not.toHaveBeenCalled();
    expect(authorized).not.toHaveBeenCalled();
  });

  it("refuses another environment's Worker (403), a re-labelled signature (400), malformed bodies (400), wrong method or type", async () => {
    const { d, reconcile } = deps();
    expect((await handleAttest(request(body({ source_env: "production" })), d)).status).toBe(403);
    expect((await handleAttest(request(body(), { id: "att_" + "cd".repeat(16) }), d)).status).toBe(400);
    for (const bad of [body({ nonce: "short" }), body({ extra: 1 }), body({ audit: "x" }), body({ switch: { enabled: "yes", version: 1, updated_at: 1 } }), body({ audit: [{ ...ROW, actor: "nope" }] }), "not json"]) {
      expect((await handleAttest(request(bad), d)).status, bad.slice(0, 40)).toBe(400);
    }
    expect((await handleAttest(request(body(), { type: "text/plain" }), d)).status).toBe(415);
    expect((await handleAttest(request(body(), { method: "GET" }), d)).status).toBe(405);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("an unconfigured app (no secret, unknown environment) answers 503 and trusts nothing", async () => {
    expect((await handleAttest(request(body()), deps({ secret: undefined }).d)).status).toBe(503);
    expect((await handleAttest(request(body()), deps({ expectedSourceEnv: undefined }).d)).status).toBe(503);
  });

  it("a database failure answers 503 (the Worker keeps its old attestation, which expires: fail closed), and never signs an authorized state it could not read", async () => {
    expect((await handleAttest(request(body()), deps({ reconcile: async () => false }).d)).status).toBe(503);
    expect((await handleAttest(request(body()), deps({ authorized: async () => null }).d)).status).toBe(503);
    expect((await handleAttest(request(body()), deps({ authorized: async () => { throw new Error("boom"); } }).d)).status).toBe(503);
  });

  it("parseAttestBody accepts the Worker's real shape and bounds the audit tail", () => {
    expect(parseAttestBody(body())?.audit).toHaveLength(1);
    expect(parseAttestBody(body({ switch: null }))?.switchState).toBeNull();
    expect(parseAttestBody(body({ audit: Array.from({ length: 21 }, () => ROW) }))).toBeNull();
  });
});
