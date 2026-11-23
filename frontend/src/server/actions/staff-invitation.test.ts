import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const cookieStore = new Map<string, string>();
const cookiesApi = {
  get: vi.fn((name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name) } : undefined)),
  set: vi.fn((name: string, value: string) => void cookieStore.set(name, value)),
  delete: vi.fn((arg: string | { name: string }) => void cookieStore.delete(typeof arg === "string" ? arg : arg.name)),
};
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => cookiesApi), headers: vi.fn(async () => ({ get: () => null })) }));

const signUp = vi.fn();
const verifyOtp = vi.fn();
const rpc = vi.fn();
const supabase = { auth: { signUp, verifyOtp }, rpc };
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(async () => supabase) }));
const { markPasswordAttachedAuthoritatively } = vi.hoisted(() => ({
  markPasswordAttachedAuthoritatively: vi.fn(async (id: string) => void id),
}));
vi.mock("@/lib/supabase/admin-server", () => ({ markPasswordAttachedAuthoritatively }));

import {
  acceptStaffInvitationAction,
  createStaffInvitationAction,
  recordStaffConsentAction,
  requestStaffSignUp,
  revokeStaffInvitationAction,
  verifyStaffSignUp,
} from "./staff-invitation";
import { STAFF_INVITATION_COOKIE } from "@/server/auth/staff-invitation-token";

const TOKEN = "a".repeat(64);
const ROLE_ID = "11111111-2222-4333-8444-555555555555";
const INVITE_ID = "99999999-2222-4333-8444-555555555555";
const PASSWORD = "Str0ng!Passw0rd-2026";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const registration = (over: Record<string, string> = {}) =>
  form({
    email: "invited.person@example.com",
    password: PASSWORD,
    displayName: "Invited Person",
    consent_terms: "on",
    consent_privacy: "on",
    consent_pilot: "on",
    captchaToken: "captcha-ok",
    ...over,
  });
const init = { ok: false };
const redirectOf = async (p: Promise<unknown>) => (await p.catch((e: Error) => e.message)) as string;

beforeEach(() => {
  cookieStore.clear();
  signUp.mockReset();
  verifyOtp.mockReset();
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
});
afterEach(() => vi.restoreAllMocks());

describe("createStaffInvitationAction (inviter)", () => {
  const good = () => form({ email: "New.Staff@Example.com", roleId: ROLE_ID, reason: "A7 QA staff onboarding" });

  it("passes only the e-mail, role and reason to the database and returns the one-time token once", async () => {
    rpc.mockResolvedValueOnce({ data: { id: INVITE_ID, token: TOKEN, expires_at: "2026-11-12T00:00:00Z" }, error: null });
    const result = await createStaffInvitationAction(init, good());
    expect(rpc).toHaveBeenCalledWith("admin_staff_invite", { p_email: "new.staff@example.com", p_role_id: ROLE_ID, p_reason: "A7 QA staff onboarding" });
    expect(result).toMatchObject({ ok: true, token: TOKEN, expiresAt: "2026-11-12T00:00:00Z" });
  });

  it("never logs the token or the address", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info")];
    rpc.mockResolvedValueOnce({ data: { id: INVITE_ID, token: TOKEN, expires_at: "2026-11-12T00:00:00Z" }, error: null });
    await createStaffInvitationAction(init, good());
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain(TOKEN);
  });

  it("refuses malformed input before any database call", async () => {
    expect((await createStaffInvitationAction(init, form({ email: "nope", roleId: ROLE_ID, reason: "A7 QA staff onboarding" }))).code).toBe("staffInvitation.error.invalidEmail");
    expect((await createStaffInvitationAction(init, form({ email: "a@example.com", roleId: "x", reason: "A7 QA staff onboarding" }))).code).toBe("staffInvitation.error.roleNotAssignable");
    expect((await createStaffInvitationAction(init, form({ email: "a@example.com", roleId: ROLE_ID, reason: "short" }))).code).toBe("staffInvitation.error.reasonRequired");
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: "42501", message: "staff_invitation: you cannot invite to a role at or above your own authority" }, "staffInvitation.error.forbidden"],
    [{ code: "42501", message: "staff_invitation: role_not_invitable" }, "staffInvitation.error.roleNotInvitable"],
    [{ code: "22023", message: "staff_invitation: already_pending" }, "staffInvitation.error.alreadyPending"],
    [{ code: "22023", message: "staff_invitation: already_holds_role" }, "staffInvitation.error.alreadyHoldsRole"],
    [{ code: "54000", message: "staff_invitation: too_many_pending" }, "staffInvitation.error.tooManyPending"],
    [{ code: "23505", message: "duplicate key value violates unique constraint" }, "staffInvitation.error.alreadyPending"],
    [{ code: "XX000", message: "boom with a secret detail" }, "staffInvitation.error.generic"],
  ])("maps a database refusal to a safe code without forwarding its text (%j)", async (error, code) => {
    rpc.mockResolvedValueOnce({ data: null, error });
    const result = await createStaffInvitationAction(init, good());
    expect(result).toMatchObject({ ok: false, code });
    expect(JSON.stringify(result)).not.toContain("secret detail");
  });
});

describe("revokeStaffInvitationAction", () => {
  it("withdraws a pending invitation with a reason", async () => {
    expect(await revokeStaffInvitationAction(init, form({ id: INVITE_ID, reason: "invited by mistake" }))).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("admin_staff_invitation_revoke", { p_id: INVITE_ID, p_reason: "invited by mistake" });
  });
  it("refuses a missing reason or a malformed id before the database", async () => {
    expect((await revokeStaffInvitationAction(init, form({ id: INVITE_ID, reason: "no" }))).code).toBe("staffInvitation.error.reasonRequired");
    expect((await revokeStaffInvitationAction(init, form({ id: "x", reason: "invited by mistake" }))).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("requestStaffSignUp (invited person, no persona)", () => {
  beforeEach(() => cookieStore.set(STAFF_INVITATION_COOKIE, TOKEN));

  it("refuses without a handoff cookie and never reaches GoTrue", async () => {
    cookieStore.clear();
    expect((await requestStaffSignUp(init, registration())).code).toBe("staffInvitation.error.invalid");
    expect(signUp).not.toHaveBeenCalled();
  });

  it("checks the e-mail against the invitation (token from the COOKIE, never the form) before signUp()", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    const result = await requestStaffSignUp(init, registration({ token: "b".repeat(64) }));
    expect(result.code).toBe("staffInvitation.error.emailMismatch");
    expect(rpc).toHaveBeenCalledWith("staff_invitation_registration_check", { p_token: TOKEN, p_email: "invited.person@example.com" });
    expect(signUp).not.toHaveBeenCalled();
  });

  it("signs up with NO account type, NO username and NO pending registration", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    signUp.mockResolvedValueOnce({ data: { user: { id: "u1" } }, error: null });
    const result = await requestStaffSignUp(init, registration({ accountType: "installer_technician", username: "sneaky" }));
    expect(result).toMatchObject({ ok: true, email: "invited.person@example.com" });
    const call = signUp.mock.calls[0]![0];
    expect(call.email).toBe("invited.person@example.com");
    expect(Object.keys(call.options.data).sort()).toEqual(["display_name", "locale"]);
    expect(call.options.captchaToken).toBe("captcha-ok");
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("pending_registration");
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });

  it("applies the marketplace password and consent rules", async () => {
    expect((await requestStaffSignUp(init, registration({ password: "short" }))).ok).toBe(false);
    expect(signUp).not.toHaveBeenCalled();
    expect((await requestStaffSignUp(init, registration({ consent_terms: "" }))).code).toBe("authPasswordPreview.error.consentRequired");
    expect((await requestStaffSignUp(init, registration({ captchaToken: "" }))).code).toBe("authPasswordPreview.error.captchaRequired");
    expect(signUp).not.toHaveBeenCalled();
  });

  it("staff invitation registration needs no age confirmation: it reaches signUp() without one", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    signUp.mockResolvedValueOnce({ data: { user: { id: "u1" } }, error: null });
    const res = await requestStaffSignUp(init, registration());
    expect(res.ok).toBe(true);
    expect(signUp).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(signUp.mock.calls[0]![0])).not.toMatch(/age/i);
  });

  it("ignores a submitted birth date: nothing about it reaches signUp()", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    signUp.mockResolvedValueOnce({ data: { user: { id: "u1" } }, error: null });
    await requestStaffSignUp(init, registration({ birthDate: "2015-01-01" }));
    expect(JSON.stringify(signUp.mock.calls[0]![0])).not.toMatch(/birth|2015/);
  });

  it("answers an already-registered address exactly like a new one (no enumeration)", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    signUp.mockResolvedValueOnce({ data: null, error: { code: "user_already_exists", status: 422 } });
    expect(await requestStaffSignUp(init, registration())).toMatchObject({ ok: true, code: "authPasswordPreview.info.codeSent" });
  });

  it("maps rate limits and rejected captchas without leaking GoTrue text", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    signUp.mockResolvedValueOnce({ data: null, error: { code: "over_email_send_rate_limit", status: 429, message: "internal detail" } });
    expect((await requestStaffSignUp(init, registration())).code).toBe("authPasswordPreview.error.rateLimited");
    signUp.mockResolvedValueOnce({ data: null, error: { code: "captcha_failed", message: "captcha verification process failed" } });
    expect((await requestStaffSignUp(init, registration())).code).toBe("authPasswordPreview.error.captchaRejected");
  });
});

describe("verifyStaffSignUp", () => {
  const code = (over: Record<string, string> = {}) => form({ email: "invited.person@example.com", token: "123456", ...over });
  const verified = { data: { user: { id: "u1", user_metadata: { display_name: "Invited Person", birth_date: "1990-01-15" } } }, error: null };

  it("verifies the e-mail code and goes straight back to the invitation: no account type, username, pending registration or onboarding", async () => {
    cookieStore.set(STAFF_INVITATION_COOKIE, TOKEN);
    verifyOtp.mockResolvedValueOnce(verified);
    expect(await redirectOf(verifyStaffSignUp(init, code()))).toBe("REDIRECT:/auth/staff-invitation");
    expect(verifyOtp).toHaveBeenCalledWith({ email: "invited.person@example.com", token: "123456", type: "signup" });
    const called = rpc.mock.calls.map((c) => c[0]);
    expect(called).toEqual(expect.arrayContaining(["record_consent", "profile_set_display_name"]));
    for (const forbidden of ["onboarding_select_account_type", "pending_registration_consume", "profile_set_username"]) expect(called).not.toContain(forbidden);
    expect(markPasswordAttachedAuthoritatively).toHaveBeenCalledWith("u1");
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/birth|1990/);
  });

  it("checks the consent write, retries once, and a persistent failure never undoes the session: the invitation page asks again", async () => {
    cookieStore.set(STAFF_INVITATION_COOKIE, TOKEN);
    verifyOtp.mockResolvedValueOnce(verified);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpc.mockImplementation(async (fn: string) => (fn === "record_consent" ? { data: null, error: { code: "XX000", message: "boom" } } : { data: null, error: null }));
    expect(await redirectOf(verifyStaffSignUp(init, code()))).toBe("REDIRECT:/auth/staff-invitation");
    expect(rpc.mock.calls.filter((c) => c[0] === "record_consent")).toHaveLength(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("consent receipts not recorded"));
    expect(JSON.stringify(log.mock.calls)).not.toContain("boom");
  });

  it("a transient consent failure is recovered by the single retry", async () => {
    cookieStore.set(STAFF_INVITATION_COOKIE, TOKEN);
    verifyOtp.mockResolvedValueOnce(verified);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let first = true;
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "record_consent" && first) {
        first = false;
        return { data: null, error: { code: "XX000", message: "blip" } };
      }
      return { data: null, error: null };
    });
    await redirectOf(verifyStaffSignUp(init, code()));
    expect(rpc.mock.calls.filter((c) => c[0] === "record_consent")).toHaveLength(2);
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("consent receipts"));
  });

  it("refuses a malformed code and a missing handoff cookie without calling GoTrue", async () => {
    cookieStore.set(STAFF_INVITATION_COOKIE, TOKEN);
    expect((await verifyStaffSignUp(init, code({ token: "12" }))).code).toBe("authPasswordPreview.error.invalidCode");
    cookieStore.clear();
    expect((await verifyStaffSignUp(init, code())).code).toBe("staffInvitation.error.invalid");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("a wrong code is a plain invalid-code answer", async () => {
    cookieStore.set(STAFF_INVITATION_COOKIE, TOKEN);
    verifyOtp.mockResolvedValueOnce({ data: { user: null }, error: { code: "otp_expired", message: "secret" } });
    expect(await verifyStaffSignUp(init, code())).toMatchObject({ ok: false, code: "authPasswordPreview.error.invalidCode" });
  });
});

describe("recordStaffConsentAction (recovery after an interrupted registration)", () => {
  const agree = () => form({ consent_agree: "on" });
  const lookupRow = (over: Record<string, unknown> = {}) => ({ status: "pending", role_name: "Administrator", email_masked: "q•••@•••.test", matches_caller: true, consent_complete: false, ...over });
  const respond = (lookups: Array<Record<string, unknown>>, consent: { error: unknown } = { error: null }) => {
    const queue = [...lookups];
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "staff_invitation_lookup") return { data: [queue.shift() ?? lookupRow()], error: null };
      if (fn === "record_consent") return { data: null, error: consent.error };
      return { data: null, error: null };
    });
  };

  it("needs the explicit agreement and the handoff cookie, and touches nothing otherwise", async () => {
    expect((await recordStaffConsentAction(init, form({}))).code).toBe("authPasswordPreview.error.consentRequired");
    expect((await recordStaffConsentAction(init, agree())).code).toBe("staffInvitation.error.invalid");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("is only for the person the invitation names", async () => {
    cookieStore.set(STAFF_INVITATION_COOKIE, TOKEN);
    respond([lookupRow({ matches_caller: false })]);
    expect((await recordStaffConsentAction(init, agree())).code).toBe("staffInvitation.error.recipientMismatch");
    expect(rpc.mock.calls.map((c) => c[0])).not.toContain("record_consent");
  });

  it("records all three consent types, re-reads the receipts and only then reports success", async () => {
    cookieStore.set(STAFF_INVITATION_COOKIE, TOKEN);
    respond([lookupRow(), lookupRow({ consent_complete: true })]);
    expect(await recordStaffConsentAction(init, agree())).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("record_consent", { p_types: ["terms", "privacy", "pilot"], p_locale: expect.any(String) });
  });

  it("does not report success when the write fails or the receipts are still missing afterwards", async () => {
    cookieStore.set(STAFF_INVITATION_COOKIE, TOKEN);
    respond([lookupRow()], { error: { code: "XX000", message: "boom" } });
    expect((await recordStaffConsentAction(init, agree())).code).toBe("staffInvitation.error.consentFailed");
    respond([lookupRow(), lookupRow({ consent_complete: false })]);
    expect((await recordStaffConsentAction(init, agree())).code).toBe("staffInvitation.error.consentFailed");
  });
});

describe("acceptStaffInvitationAction", () => {
  it("needs the handoff cookie", async () => {
    expect((await acceptStaffInvitationAction()).code).toBe("staffInvitation.error.invalid");
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["staff_invitation: recipient_mismatch", "staffInvitation.error.recipientMismatch"],
    ["staff_invitation: inviter_not_authorized", "staffInvitation.error.inviterNotAuthorized"],
    ["staff_invitation: account_not_eligible", "staffInvitation.error.accountNotEligible"],
    ["staff_invitation: consent_required", "staffInvitation.error.consentRequired"],
    ["staff_invitation: expired", "staffInvitation.error.expired"],
    ["staff_invitation: invalid", "staffInvitation.error.invalid"],
    ["staff_invitation: you cannot accept your own invitation", "staffInvitation.error.self"],
  ])("a refusal (%s) keeps the cookie, maps to a safe code and grants nothing", async (message, expected) => {
    cookieStore.set(STAFF_INVITATION_COOKIE, TOKEN);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message } });
    expect(await acceptStaffInvitationAction()).toMatchObject({ ok: false, code: expected });
    expect(cookieStore.get(STAFF_INVITATION_COOKIE)).toBe(TOKEN);
  });

  it("success consumes the cookie and lands on /admin", async () => {
    cookieStore.set(STAFF_INVITATION_COOKIE, TOKEN);
    rpc.mockResolvedValueOnce({ data: { status: "accepted" }, error: null });
    expect(await redirectOf(acceptStaffInvitationAction())).toBe("REDIRECT:/admin");
    expect(rpc).toHaveBeenCalledWith("staff_invitation_accept", { p_token: TOKEN });
    expect(cookieStore.has(STAFF_INVITATION_COOKIE)).toBe(false);
  });
});
