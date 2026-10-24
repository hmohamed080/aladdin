import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin-server", () => ({ getInstallerSecurityAdminClient: () => ({}) }));
vi.mock("@/lib/env", () => ({ readPublicEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:1", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" }) }));

import { SECURITY_CODES, performPasswordChange, performPhoneChange, type SecurityActor, type SecurityDeps, type SessionOps } from "./installer-security";

/**
 * MOCKED unit tests: every collaborator (PR #88's account_password_confirm, the M3/M4 RPCs, the Auth Admin API, the
 * isolated new-password probe) is a
 * fake, so these prove the ORCHESTRATION - ordering, trust, error mapping, what is and is not called. They are not
 * integration tests; the real-GoTrue / real-Postgres proof is `installer-security.live.test.ts`.
 */

const USER = "3f2b8c1e-5a4d-4e6f-9a7b-0c1d2e3f4a5b";
const ALIAS = "p201093817264@craftsman-login.aladdin.invalid";
const NEW_E164 = "+201012345678";
const NEW_ALIAS = "p201012345678@craftsman-login.aladdin.invalid";
const RECEIPT = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const CHANGE = "7d6c5b4a-3210-4fed-8cba-9876543210ab";
const GOOD = "Cx7-correct-horse-9!";
const NEW_PW = "Zq8-brand-new-pass!";

type Rpc = (name: string, args: Record<string, unknown>) => { data: unknown; error: { code?: string } | null };

function build(over: {
  rpc?: Rpc;
  verify?: SecurityDeps["verifyPassword"];
  confirm?: SecurityDeps["confirmPassword"];
  update?: (id: string, attrs: Record<string, unknown>) => Promise<{ error: unknown }>;
  updatePw?: (password: string, currentPassword: string) => Promise<{ error: { status?: number; code?: string } | null }>;
} = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const base: Rpc = (name) => {
    switch (name) {
      case "identity_password_change_authorize": return { data: true, error: null };
      case "installer_phone_change_status": return { data: [], error: null };
      case "installer_phone_change_begin": return { data: [{ change_id: CHANGE, state: "pending", old_alias: ALIAS, new_alias: NEW_ALIAS, replayed: false }], error: null };
      case "installer_phone_change_settle": return { data: [{ state: "done", resolution: "applied" }], error: null };
      case "identity_password_change_audit": return { data: true, error: null };
      default: return { data: null, error: { code: "XX000" } };
    }
  };
  const rpcImpl = over.rpc ?? base;
  const updates: { id: string; attrs: Record<string, unknown> }[] = [];
  const confirms: { op: string; target: string }[] = [];
  const deps: SecurityDeps = {
    rpc: { rpc: vi.fn(async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return rpcImpl(name, args) ?? base(name, args); }) } as unknown as SecurityDeps["rpc"],
    admin: { updateUserById: vi.fn(async (id: string, attrs: Record<string, unknown>) => { updates.push({ id, attrs }); return (over.update ? over.update(id, attrs) : { error: null }) as never; }) } as unknown as SecurityDeps["admin"],
    confirmPassword: vi.fn(async (op: string, target: string, password: string) => {
      confirms.push({ op, target });
      if (over.confirm) return over.confirm(op as never, target, password);
      return password === GOOD ? { ok: true as const, receipt: RECEIPT } : { ok: false as const, reason: "wrong_password" as const };
    }) as unknown as SecurityDeps["confirmPassword"],
    verifyPassword: over.verify ?? (async ({ password }) => password === GOOD),
    newId: () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  };
  const session: SessionOps = {
    refreshSession: vi.fn(async () => {}),
    endOtherSessions: vi.fn(async () => {}),
    updatePassword: vi.fn(async (password: string, currentPassword: string) => (over.updatePw ? over.updatePw(password, currentPassword) : { error: null })),
  };
  return { deps, session, calls, updates, confirms };
}
const actor: SecurityActor = { userId: USER, loginEmail: ALIAS, displayName: "Hassan Ali" };
const phoneInput = (over: Record<string, unknown> = {}) => ({ countryIso2: "EG", national: "1012345678", password: GOOD, ...over });
const pwInput = (over: Record<string, unknown> = {}) => ({ currentPassword: GOOD, newPassword: NEW_PW, confirmPassword: NEW_PW, ...over });
const names = (c: { name: string }[]) => c.map((x) => x.name);

beforeEach(() => vi.restoreAllMocks());

describe("performPhoneChange (mocked collaborators)", () => {
  it("success: password confirm -> begin -> Admin API with the DB-derived alias -> settle -> session refresh + other sessions ended", async () => {
    const t = build();
    const r = await performPhoneChange(t.deps, actor, t.session, phoneInput());
    expect(r).toEqual({ ok: true, code: SECURITY_CODES.phoneDone });
    expect(names(t.calls)).toEqual([
      "installer_phone_change_status", "installer_phone_change_begin", "installer_phone_change_settle",
    ]);
    expect(t.updates).toEqual([{ id: USER, attrs: { email: NEW_ALIAS, email_confirm: true } }]);
    expect(t.confirms).toEqual([{ op: "primary_phone.change", target: NEW_E164 }]);   // the receipt is bound to THIS number
    expect(t.calls.find((c) => c.name === "installer_phone_change_begin")?.args).toMatchObject({ p_user_id: USER, p_e164: NEW_E164, p_country_iso2: "EG", p_national: "1012345678", p_receipt_id: RECEIPT });
    expect(t.session.refreshSession).toHaveBeenCalledOnce();
    expect(t.session.endOtherSessions).toHaveBeenCalledOnce();
  });

  it("the new alias comes from the database, never computed from input; the response carries no alias, phone or secret", async () => {
    const t = build();
    const r = await performPhoneChange(t.deps, actor, t.session, phoneInput());
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/craftsman-login|201012345678|201093817264|Zq8|Cx7|9b1deb4d/);
  });

  it("a client-supplied E.164, user id or alias is ignored: only country + national are used", async () => {
    const t = build();
    await performPhoneChange(t.deps, actor, t.session, { ...phoneInput(), e164: "+201099999999", userId: "x", alias: "evil@x" } as never);
    expect(t.calls.find((c) => c.name === "installer_phone_change_begin")?.args).toMatchObject({ p_user_id: USER, p_e164: NEW_E164 });
  });

  it("Arabic-Indic digits are accepted and canonicalised", async () => {
    const t = build();
    const r = await performPhoneChange(t.deps, actor, t.session, phoneInput({ national: "١٠١٢٣٤٥٦٧٨" }));
    expect(r.ok).toBe(true);
  });

  it.each([
    ["not a phone", { national: "abc" }],
    ["too short", { national: "12" }],
    ["unknown country", { countryIso2: "ZZ" }],
    ["missing country", { countryIso2: "" }],
  ])("invalid phone (%s) is refused before any attempt is spent", async (_n, over) => {
    const t = build();
    expect(await performPhoneChange(t.deps, actor, t.session, phoneInput(over))).toEqual({ ok: false, code: SECURITY_CODES.phoneInvalid });
    expect(t.calls).toEqual([]);
  });

  it("the current number is refused before any attempt is spent", async () => {
    const t = build();
    expect(await performPhoneChange(t.deps, actor, t.session, phoneInput({ national: "1093817264" }))).toEqual({ ok: false, code: SECURITY_CODES.phoneSame });
    expect(t.calls).toEqual([]);
  });

  it("a missing password is refused before any attempt is spent", async () => {
    const t = build();
    expect(await performPhoneChange(t.deps, actor, t.session, phoneInput({ password: "" }))).toEqual({ ok: false, code: SECURITY_CODES.passwordRequired });
    expect(t.calls).toEqual([]);
  });

  it("wrong current password: counted as a failed attempt, no begin, no Admin call", async () => {
    const t = build();
    const r = await performPhoneChange(t.deps, actor, t.session, phoneInput({ password: "nope" }));
    expect(r).toEqual({ ok: false, code: SECURITY_CODES.wrongPassword });
    expect(t.confirms).toHaveLength(1);
    expect(names(t.calls)).not.toContain("installer_phone_change_begin");
    expect(t.updates).toEqual([]);
  });

  it("a confirmation outage is NOT reported as 'wrong password'", async () => {
    const t = build({ confirm: async () => ({ ok: false, reason: "unavailable" }) });
    expect(await performPhoneChange(t.deps, actor, t.session, phoneInput())).toEqual({ ok: false, code: SECURITY_CODES.unavailable });
  });

  it("lockout (one budget per account): refused with a retry-after, nothing changed", async () => {
    const t = build({ confirm: async () => ({ ok: false, reason: "locked", retryAfterSeconds: 900 }) });
    expect(await performPhoneChange(t.deps, actor, t.session, phoneInput())).toEqual({ ok: false, code: SECURITY_CODES.locked, retryAfterSeconds: 900 });
    expect(names(t.calls)).not.toContain("installer_phone_change_begin");
    expect(t.updates).toEqual([]);
  });

  it("an account without a password (social sign-in) cannot confirm and changes nothing", async () => {
    const t = build({ confirm: async () => ({ ok: false, reason: "no_password" }) });
    expect(await performPhoneChange(t.deps, actor, t.session, phoneInput())).toEqual({ ok: false, code: SECURITY_CODES.unavailable });
    expect(names(t.calls)).not.toContain("installer_phone_change_begin");
  });

  it("receipt mismatch / expiry (begin answers 42501) maps to 'verification expired' and changes nothing", async () => {
    const t = build({ rpc: (name) => name === "installer_phone_change_begin" ? { data: null, error: { code: "42501" } } : (undefined as never) });
    expect(await performPhoneChange(t.deps, actor, t.session, phoneInput())).toEqual({ ok: false, code: SECURITY_CODES.verificationExpired });
    expect(t.updates).toEqual([]);
  });

  it("duplicate phone (generic 23505) maps to 'unavailable' and never reaches Auth", async () => {
    const t = build({ rpc: (name) => name === "installer_phone_change_begin" ? { data: null, error: { code: "23505" } } : (undefined as never) });
    expect(await performPhoneChange(t.deps, actor, t.session, phoneInput())).toEqual({ ok: false, code: SECURITY_CODES.phoneUnavailable });
    expect(t.updates).toEqual([]);
  });

  it("a concurrent change (55006) maps to 'in progress'", async () => {
    const t = build({ rpc: (name) => name === "installer_phone_change_begin" ? { data: null, error: { code: "55006" } } : (undefined as never) });
    expect(await performPhoneChange(t.deps, actor, t.session, phoneInput())).toEqual({ ok: false, code: SECURITY_CODES.phoneInProgress });
  });

  it("Auth Admin API REFUSES (4xx): settle is told the call finished, the database compensates, the user is told nothing changed", async () => {
    const t = build({
      update: async () => ({ error: { status: 422, code: "email_exists" } }),
      rpc: (name) => name === "installer_phone_change_settle" ? { data: [{ state: "compensated", resolution: "restored" }], error: null } : (undefined as never),
    });
    const r = await performPhoneChange(t.deps, actor, t.session, phoneInput());
    expect(r).toEqual({ ok: false, code: SECURITY_CODES.phoneFailed });
    expect(t.calls.find((c) => c.name === "installer_phone_change_settle")?.args).toMatchObject({ p_attempt_finished: true });
    expect(t.session.refreshSession).not.toHaveBeenCalled();
    expect(t.session.endOtherSessions).not.toHaveBeenCalled();
  });

  it("HTTP 500 is an UNKNOWN outcome: one settlement, no pause, no second look; the database decides (guard in force -> compensated at once)", async () => {
    const settleCalls: boolean[] = [];
    const t = build({
      update: async () => ({ error: { status: 500, name: "AuthRetryableFetchError" } }),
      rpc: (name, args) => {
        if (name !== "installer_phone_change_settle") return undefined as never;
        settleCalls.push(args.p_attempt_finished as boolean);
        return { data: [{ state: "compensated", resolution: "restored" }], error: null };
      },
    });
    expect(await performPhoneChange(t.deps, actor, t.session, phoneInput())).toEqual({ ok: false, code: SECURITY_CODES.phoneFailed });
    expect(settleCalls).toEqual([false]);                    // 500 is NOT reported as 'the call finished with a refusal'
    expect(t.session.refreshSession).not.toHaveBeenCalled();
  });

  it("HTTP 500 AFTER a committed update: settlement observes the new alias - success, never compensated", async () => {
    const t = build({
      update: async () => ({ error: { status: 500, name: "AuthRetryableFetchError" } }),
      rpc: (name) => name === "installer_phone_change_settle" ? { data: [{ state: "done", resolution: "applied" }], error: null } : (undefined as never),
    });
    expect(await performPhoneChange(t.deps, actor, t.session, phoneInput())).toEqual({ ok: true, code: SECURITY_CODES.phoneDone });
    expect(t.session.refreshSession).toHaveBeenCalledOnce();
  });

  it("guard NOT in force and the alias still old: settlement stays pending and the request does NOT report success", async () => {
    const t = build({
      update: async () => ({ error: { status: 500 } }),
      rpc: (name) => name === "installer_phone_change_settle" ? { data: [{ state: "pending", resolution: null }], error: null } : (undefined as never),
    });
    expect(await performPhoneChange(t.deps, actor, t.session, phoneInput())).toEqual({ ok: false, code: SECURITY_CODES.phoneNotConfirmed });
    expect(t.session.refreshSession).not.toHaveBeenCalled();
  });

  it("a 4xx refusal is compensated at once (GoTrue refuses before it changes anything)", async () => {
    const t = build({
      update: async () => ({ error: { status: 422, code: "email_exists" } }),
      rpc: (name) => name === "installer_phone_change_settle" ? { data: [{ state: "compensated", resolution: "restored" }], error: null } : (undefined as never),
    });
    await performPhoneChange(t.deps, actor, t.session, phoneInput());
    expect(t.calls.filter((c) => c.name === "installer_phone_change_settle").map((c) => c.args.p_attempt_finished)).toEqual([true]);
  });

  it("timeout / dropped connection / proxy error / 500 are all 'unknown': one non-finished settlement each, no pause", async () => {
    for (const status of [undefined, 0, 500, 502, 503, 504]) {
      const t = build({
        update: async () => ({ error: { status } }),
        rpc: (name) => name === "installer_phone_change_settle" ? { data: [{ state: "pending", resolution: null }], error: null } : (undefined as never),
      });
      expect(await performPhoneChange(t.deps, actor, t.session, phoneInput())).toEqual({ ok: false, code: SECURITY_CODES.phoneNotConfirmed });
      expect(t.calls.filter((c) => c.name === "installer_phone_change_settle").map((c) => c.args.p_attempt_finished)).toEqual([false]);
    }
  });

  it("the database reporting an alias/profile disagreement at begin (55000) fails closed to support, not to 'not an installer'", async () => {
    const t = build({ rpc: (name) => name === "installer_phone_change_begin" ? { data: null, error: { code: "55000" } } : (undefined as never) });
    expect(await performPhoneChange(t.deps, actor, t.session, phoneInput())).toEqual({ ok: false, code: SECURITY_CODES.needsAttention });
  });

  it("LOST Auth response (5xx/network) but the alias DID change: settle (not finished) observes it and the change succeeds", async () => {
    const t = build({ update: async () => ({ error: { status: undefined, name: "AuthRetryableFetchError" } }) });
    const r = await performPhoneChange(t.deps, actor, t.session, phoneInput());
    expect(r).toEqual({ ok: true, code: SECURITY_CODES.phoneDone });
    expect(t.calls.find((c) => c.name === "installer_phone_change_settle")?.args).toMatchObject({ p_attempt_finished: false });
  });

  it("outcome unknown and still old: NOT reported as success and NOT compensated early (pending within the lease)", async () => {
    const t = build({
      update: async () => ({ error: { status: 503 } }),
      rpc: (name) => name === "installer_phone_change_settle" ? { data: [{ state: "pending", resolution: null }], error: null } : (undefined as never),
    });
    const r = await performPhoneChange(t.deps, actor, t.session, phoneInput());
    expect(r).toEqual({ ok: false, code: SECURITY_CODES.phoneNotConfirmed });
    expect(t.session.refreshSession).not.toHaveBeenCalled();
  });

  it("a settle that errors is never success", async () => {
    const t = build({ rpc: (name) => name === "installer_phone_change_settle" ? { data: null, error: { code: "XX000" } } : (undefined as never) });
    expect(await performPhoneChange(t.deps, actor, t.session, phoneInput())).toEqual({ ok: false, code: SECURITY_CODES.phoneNotConfirmed });
  });

  it("needs_attention fails closed with the support code", async () => {
    const t = build({ rpc: (name) => name === "installer_phone_change_settle" ? { data: [{ state: "needs_attention", resolution: "alias_unexpected" }], error: null } : (undefined as never) });
    expect(await performPhoneChange(t.deps, actor, t.session, phoneInput())).toEqual({ ok: false, code: SECURITY_CODES.needsAttention });
  });

  it("RECOVERY: a leftover pending change is settled first; if it is still in flight the new request waits", async () => {
    const t = build({
      rpc: (name) => name === "installer_phone_change_status" ? { data: [{ change_id: CHANGE, state: "pending", resolution: null, lease_expired: false }], error: null }
        : name === "installer_phone_change_settle" ? { data: [{ state: "pending", resolution: null }], error: null } : (undefined as never),
    });
    expect(await performPhoneChange(t.deps, actor, t.session, phoneInput())).toEqual({ ok: false, code: SECURITY_CODES.phoneInProgress });
    expect(t.confirms).toEqual([]);
  });

  it("RECOVERY: a leftover change that settles as compensated lets the new request proceed", async () => {
    let settles = 0;
    const t = build({
      rpc: (name) => {
        if (name === "installer_phone_change_status") return { data: [{ change_id: "old", state: "pending", resolution: null, lease_expired: true }], error: null };
        if (name === "installer_phone_change_settle") { settles += 1; return settles === 1 ? { data: [{ state: "compensated", resolution: "restored" }], error: null } : { data: [{ state: "done", resolution: "applied" }], error: null }; }
        return undefined as never;
      },
    });
    expect(await performPhoneChange(t.deps, actor, t.session, phoneInput())).toEqual({ ok: true, code: SECURITY_CODES.phoneDone });
  });

  it("RECOVERY: a leftover change in needs_attention blocks with the support code", async () => {
    const t = build({
      rpc: (name) => name === "installer_phone_change_status" ? { data: [{ change_id: "old", state: "needs_attention", resolution: "alias_unexpected", lease_expired: false }], error: null }
        : name === "installer_phone_change_settle" ? { data: [{ state: "needs_attention", resolution: "alias_unexpected" }], error: null } : (undefined as never),
    });
    expect(await performPhoneChange(t.deps, actor, t.session, phoneInput())).toEqual({ ok: false, code: SECURITY_CODES.needsAttention });
  });

  it("a duplicate submission (same request id) that replays an already-done change reports success without a second Admin call", async () => {
    const t = build({ rpc: (name) => name === "installer_phone_change_begin" ? { data: [{ change_id: CHANGE, state: "done", old_alias: ALIAS, new_alias: NEW_ALIAS, replayed: true }], error: null } : (undefined as never) });
    const r = await performPhoneChange(t.deps, actor, t.session, phoneInput({ requestId: "11111111-2222-4333-8444-555555555555" }));
    expect(r.ok).toBe(true);
    expect(t.updates).toEqual([]);
    expect(t.calls.find((c) => c.name === "installer_phone_change_begin")?.args).toMatchObject({ p_request_id: "11111111-2222-4333-8444-555555555555" });
  });

  it("a malformed request id is replaced by a server-generated one", async () => {
    const t = build();
    await performPhoneChange(t.deps, actor, t.session, phoneInput({ requestId: "not-a-uuid" }));
    expect(t.calls.find((c) => c.name === "installer_phone_change_begin")?.args).toMatchObject({ p_request_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" });
  });

  it("no session, or a non-installer (email) account, cannot invoke it", async () => {
    const t = build();
    expect(await performPhoneChange(t.deps, null, t.session, phoneInput())).toEqual({ ok: false, code: SECURITY_CODES.sessionExpired });
    expect(await performPhoneChange(t.deps, { ...actor, loginEmail: "sara@example.com" }, t.session, phoneInput())).toEqual({ ok: false, code: SECURITY_CODES.notInstaller });
    expect(t.calls).toEqual([]);
  });

  it("session refresh / other-session failures do not turn a completed change into an error, and never leak details", async () => {
    const t = build();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    (t.session.refreshSession as ReturnType<typeof vi.fn>).mockRejectedValue(new Error(`token ${ALIAS}`));
    (t.session.endOtherSessions as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
    expect(await performPhoneChange(t.deps, actor, t.session, phoneInput())).toEqual({ ok: true, code: SECURITY_CODES.phoneDone });
    expect(spy.mock.calls.flat().join(" ")).not.toContain("craftsman-login");
  });
});

describe("performPasswordChange (mocked collaborators)", () => {
  it("success: password confirm -> receipt SPENT before the mutation -> own-session password update -> audit -> other sessions ended", async () => {
    const t = build();
    const r = await performPasswordChange(t.deps, actor, t.session, pwInput());
    expect(r).toEqual({ ok: true, code: SECURITY_CODES.passwordDone });
    expect(names(t.calls)).toEqual(["identity_password_change_authorize", "identity_password_change_audit"]);
    expect(t.calls.find((c) => c.name === "identity_password_change_authorize")?.args).toEqual({ p_user_id: USER, p_receipt_id: RECEIPT });
    expect(t.confirms).toEqual([{ op: "password.change", target: "self" }]);
    expect(t.session.updatePassword).toHaveBeenCalledTimes(1);
    expect(t.session.updatePassword).toHaveBeenCalledWith(NEW_PW, GOOD);   // through the caller's OWN session, BOTH values
    expect(t.updates).toEqual([]);                                                // the Admin API (which would revoke this session too) is not used
    expect(t.session.endOtherSessions).toHaveBeenCalledOnce();
    expect(t.session.refreshSession).not.toHaveBeenCalled();
    expect(t.calls.some((c) => c.name.startsWith("installer_phone_change"))).toBe(false);
  });

  it("the response contains no password, alias or receipt", async () => {
    const t = build();
    expect(JSON.stringify(await performPasswordChange(t.deps, actor, t.session, pwInput()))).not.toMatch(/Zq8|Cx7|craftsman-login|9b1deb4d/);
  });

  it("wrong current password: counted, no receipt spent, no Auth mutation", async () => {
    const t = build();
    expect(await performPasswordChange(t.deps, actor, t.session, pwInput({ currentPassword: "wrong-password-1!" }))).toEqual({ ok: false, code: SECURITY_CODES.wrongPassword });
    expect(names(t.calls)).not.toContain("identity_password_change_authorize");
    expect(t.session.updatePassword).not.toHaveBeenCalled();
  });

  it.each([
    ["too short", "Ab1!", "temporaryCraftsman.error.passwordTooShort"],
    ["too common", "password123456", "temporaryCraftsman.error.passwordCommon"],
    ["sequential", "aaaaaaaaaaaaaa", "temporaryCraftsman.error.passwordSequential"],
    ["contains the phone", "my201093817264zz", "temporaryCraftsman.error.passwordAccountRelated"],
  ])("weak new password (%s) is refused BEFORE any attempt is spent", async (_n, weak, code) => {
    const t = build();
    expect(await performPasswordChange(t.deps, actor, t.session, pwInput({ newPassword: weak, confirmPassword: weak }))).toEqual({ ok: false, code });
    expect(t.calls).toEqual([]);
  });

  it("over-long (72-byte) password is refused", async () => {
    const t = build();
    const long = "Xk9!".repeat(20);
    expect(await performPasswordChange(t.deps, actor, t.session, pwInput({ newPassword: long, confirmPassword: long }))).toEqual({ ok: false, code: "temporaryCraftsman.error.passwordTooLong" });
  });

  it("confirmation mismatch and identical old/new are refused before any attempt is spent", async () => {
    const t = build();
    expect(await performPasswordChange(t.deps, actor, t.session, pwInput({ confirmPassword: "different-Pass-77!" }))).toEqual({ ok: false, code: SECURITY_CODES.passwordMismatch });
    expect(await performPasswordChange(t.deps, actor, t.session, pwInput({ newPassword: GOOD, confirmPassword: GOOD }))).toEqual({ ok: false, code: SECURITY_CODES.passwordSame });
    expect(t.calls).toEqual([]);
  });

  it("lockout: refused with retry-after; nothing spent or changed", async () => {
    const t = build({ confirm: async () => ({ ok: false, reason: "locked", retryAfterSeconds: 600 }) });
    expect(await performPasswordChange(t.deps, actor, t.session, pwInput())).toEqual({ ok: false, code: SECURITY_CODES.locked, retryAfterSeconds: 600 });
    expect(names(t.calls)).not.toContain("identity_password_change_authorize");
    expect(t.session.updatePassword).not.toHaveBeenCalled();
  });

  it("receipt replay / expiry (authorize answers false): the password is NOT changed", async () => {
    const t = build({ rpc: (name) => name === "identity_password_change_authorize" ? { data: false, error: null } : (undefined as never) });
    expect(await performPasswordChange(t.deps, actor, t.session, pwInput())).toEqual({ ok: false, code: SECURITY_CODES.verificationExpired });
    expect(t.session.updatePassword).not.toHaveBeenCalled();
    expect(t.session.endOtherSessions).not.toHaveBeenCalled();
  });

  it("Auth refuses the password update: reported as unavailable, no audit, other sessions untouched", async () => {
    const t = build({ updatePw: async () => ({ error: { status: 500 } }), verify: async ({ password }) => password === GOOD });
    expect(await performPasswordChange(t.deps, actor, t.session, pwInput())).toEqual({ ok: false, code: SECURITY_CODES.unavailable });
    expect(names(t.calls)).not.toContain("identity_password_change_audit");
    expect(t.session.endOtherSessions).not.toHaveBeenCalled();
  });

  it("Auth's own weak-password verdict is surfaced as 'rejected'", async () => {
    const t = build({ updatePw: async () => ({ error: { status: 422, code: "weak_password" } }) });
    expect(await performPasswordChange(t.deps, actor, t.session, pwInput())).toEqual({ ok: false, code: SECURITY_CODES.passwordRejected });
  });

  it("outcome unknown but the NEW password now works: treated as applied", async () => {
    const t = build({ updatePw: async () => ({ error: { status: undefined } }), verify: async ({ password }) => password === GOOD || password === NEW_PW });
    expect(await performPasswordChange(t.deps, actor, t.session, pwInput())).toEqual({ ok: true, code: SECURITY_CODES.passwordDone });
  });

  it("outcome unknown and the new password does not work: not success", async () => {
    const t = build({ updatePw: async () => ({ error: { status: undefined } }) });
    expect((await performPasswordChange(t.deps, actor, t.session, pwInput())).ok).toBe(false);
  });

  it("HTTP 500 from the password update AFTER it committed: the new password works - reported as success", async () => {
    const t = build({ updatePw: async () => ({ error: { status: 500 } }), verify: async ({ password }) => password === GOOD || password === NEW_PW });
    expect(await performPasswordChange(t.deps, actor, t.session, pwInput())).toEqual({ ok: true, code: SECURITY_CODES.passwordDone });
    expect(t.session.endOtherSessions).toHaveBeenCalledOnce();
  });

  it("HTTP 500 from the password update BEFORE it committed: the new password does not work - not success", async () => {
    const t = build({ updatePw: async () => ({ error: { status: 500 } }), verify: async ({ password }) => password === GOOD });
    expect(await performPasswordChange(t.deps, actor, t.session, pwInput())).toEqual({ ok: false, code: SECURITY_CODES.unavailable });
    expect(names(t.calls)).not.toContain("identity_password_change_audit");
  });

  it("GoTrue's native current_password_invalid (the password changed under us) is reported as the wrong password and changes nothing", async () => {
    const t = build({ updatePw: async () => ({ error: { status: 400, code: "current_password_invalid" } }) });
    expect(await performPasswordChange(t.deps, actor, t.session, pwInput())).toEqual({ ok: false, code: SECURITY_CODES.wrongPassword });
    expect(names(t.calls)).not.toContain("identity_password_change_audit");
    expect(t.session.endOtherSessions).not.toHaveBeenCalled();
  });

  it("GoTrue's native current_password_required maps to 'enter your current password' (and is not mistaken for an unknown outcome)", async () => {
    const verify = vi.fn(async ({ password }: { password: string }) => password === GOOD);
    const t = build({ updatePw: async () => ({ error: { status: 400, code: "current_password_required" } }), verify });
    expect(await performPasswordChange(t.deps, actor, t.session, pwInput())).toEqual({ ok: false, code: SECURITY_CODES.passwordRequired });
    expect(verify).not.toHaveBeenCalled();                   // no 'does the new password work?' probe was needed
  });

  it("a session that needs re-authentication is reported as session expired", async () => {
    const t = build({ updatePw: async () => ({ error: { status: 400, code: "reauthentication_needed" } }) });
    expect(await performPasswordChange(t.deps, actor, t.session, pwInput())).toEqual({ ok: false, code: SECURITY_CODES.sessionExpired });
  });

  it("an audit failure does not hide a password that has changed", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = build({ rpc: (name) => name === "identity_password_change_audit" ? { data: false, error: null } : (undefined as never) });
    expect(await performPasswordChange(t.deps, actor, t.session, pwInput())).toEqual({ ok: true, code: SECURITY_CODES.passwordDone });
    expect(spy).toHaveBeenCalled();
  });

  it("no session / non-installer account cannot invoke it", async () => {
    const t = build();
    expect(await performPasswordChange(t.deps, null, t.session, pwInput())).toEqual({ ok: false, code: SECURITY_CODES.sessionExpired });
    expect(await performPasswordChange(t.deps, { ...actor, loginEmail: "sara@example.com" }, t.session, pwInput())).toEqual({ ok: false, code: SECURITY_CODES.notInstaller });
    expect(t.calls).toEqual([]);
  });

  it("a missing current password is refused first", async () => {
    const t = build();
    expect(await performPasswordChange(t.deps, actor, t.session, pwInput({ currentPassword: "" }))).toEqual({ ok: false, code: SECURITY_CODES.passwordRequired });
  });
});
