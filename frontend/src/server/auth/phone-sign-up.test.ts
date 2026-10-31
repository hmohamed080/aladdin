import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn((url: string) => { throw Error("REDIRECT:" + url); }) }));
const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined),
    set: (name: string, value: string, options: { maxAge?: number }) => (options.maxAge === 0 ? cookieJar.delete(name) : cookieJar.set(name, value)),
  })),
  headers: vi.fn(async () => ({ get: () => null })),
}));
const envState = vi.hoisted(() => ({ secret: "cookie-secret-cookie-secret-cookie-secret-00" as string | undefined }));
vi.mock("@/lib/env/phone-verification", () => ({ readPhoneVerificationEnv: () => ({ signupCookieSecret: envState.secret }) }));

const RID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CID = "11111111-1111-4111-8111-111111111111";
const CID2 = "22222222-2222-4222-8222-222222222222";
const ALIAS = "p201012345678@craftsman-login.aladdin.invalid";

const m = vi.hoisted(() => ({
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  rpc: vi.fn(),
  siteverify: vi.fn(),
  limit: vi.fn(),
  phoneTaken: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  birthday: vi.fn(),
  start: vi.fn(),
  verify: vi.fn(),
  attach: vi.fn(),
  service: vi.fn(),
  order: [] as string[],
}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: async () => ({ auth: { getUser: m.getUser, signInWithPassword: m.signInWithPassword, signOut: m.signOut }, rpc: m.rpc }),
}));
vi.mock("@/server/auth/turnstile", () => ({ verifyTurnstileToken: m.siteverify, clientIpFrom: () => "203.0.113.9", turnstileHostnamesFrom: () => [] }));
vi.mock("@/server/auth/phone-auth-limit", () => ({ phoneAuthLimit: m.limit }));
vi.mock("@/server/phone-verification/runtime", () => ({ getPhoneSignupService: m.service }));
vi.mock("@/lib/supabase/admin-server", () => ({
  isCanonicalPhoneTaken: m.phoneTaken,
  createPhoneSignUpUser: m.createUser,
  deleteCraftsmanPasswordUser: m.deleteUser,
  saveVerifiedBirthDate: m.birthday,
}));

import { requestPhoneSignUp, resendPhoneSignUpCode, verifyPhoneSignUp } from "./phone-sign-up";
import { parsePhone } from "@/features/installer-phone-auth/validation";

const PHONE = (parsePhone("01012345678") as { ok: true; value: Parameters<typeof requestPhoneSignUp>[1] }).value;
const GOOD_PASSWORD = "a-long-and-unusual-passphrase";
const grantFor = (registrationId: string, over: Record<string, string> = {}) => ({
  id: "33333333-3333-4333-8333-333333333333", registrationId, alias: ALIAS, phone: "+201012345678", expiresAt: new Date(Date.now() + 60_000).toISOString(), ...over,
});

function form(patch: Record<string, string> = {}) {
  const data = new FormData();
  const base: Record<string, string> = {
    contact: "01012345678",
    displayName: "Mona Adel",
    username: "mona.adel",
    accountType: "supplier",
    password: GOOD_PASSWORD,
    birthDate: "1990-05-17",
    consent_terms: "on",
    consent_privacy: "on",
    consent_pilot: "on",
    captchaToken: "token-a",
  };
  for (const [key, value] of Object.entries({ ...base, ...patch })) data.set(key, value);
  return data;
}

async function run<T>(fn: () => Promise<T>): Promise<T | string> {
  try {
    return await fn();
  } catch (e) {
    return (e as Error).message;
  }
}

const registrationId = () => m.start.mock.calls.at(0)?.[0] as string;

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.clear();
  envState.secret = "cookie-secret-cookie-secret-cookie-secret-00";
  m.order.length = 0;
  m.getUser.mockResolvedValue({ data: { user: null }, error: null });
  m.siteverify.mockResolvedValue({ ok: true });
  m.limit.mockResolvedValue("allowed");
  m.phoneTaken.mockResolvedValue(false);
  m.start.mockResolvedValue({ status: "sent", challengeId: CID, expiresAt: "x", resendAvailableAt: "y" });
  m.verify.mockImplementation(async (rid: string) => ({ status: "verified", grant: grantFor(rid) }));
  m.attach.mockImplementation(async () => { m.order.push("attach"); return { status: "attached" }; });
  m.service.mockReturnValue({ start: m.start, verify: m.verify, attach: m.attach });
  m.createUser.mockImplementation(async () => { m.order.push("create"); return { ok: true, userId: "u-new" }; });
  m.deleteUser.mockResolvedValue(true);
  m.birthday.mockImplementation(async () => { m.order.push("birthday"); });
  m.signInWithPassword.mockResolvedValue({ error: null });
  m.signOut.mockResolvedValue({ error: null });
  m.rpc.mockImplementation(async (name: string) => { m.order.push(name); return name === "username_available" ? { data: true, error: null } : { data: null, error: null }; });
});

const verifyForm = (token: string) => {
  const data = new FormData();
  data.set("token", token);
  data.set("captchaToken", "token-b");
  return data;
};

async function startSignUp() {
  const res = await requestPhoneSignUp(form(), PHONE);
  expect(res).toMatchObject({ ok: true, channel: "phone", code: "authPasswordPreview.info.whatsappCodeSent" });
}

describe("requestPhoneSignUp", () => {
  it("checks every field, Turnstile, the limiter and the username, then asks the authority for a challenge - it holds no code of its own", async () => {
    await startSignUp();
    expect(m.siteverify).toHaveBeenCalledWith("token-a", expect.objectContaining({ expectedAction: "sign-up" }));
    expect(m.start).toHaveBeenCalledWith(expect.stringMatching(RID_RE), "+201012345678", "203.0.113.9", "ar");
    // The password lives only in the sealed cookie.
    const sealed = cookieJar.get("psu") ?? "";
    expect(sealed).not.toContain(GOOD_PASSWORD);
    expect(Buffer.from(sealed, "base64url").toString("utf8")).not.toContain(GOOD_PASSWORD);
    expect(m.createUser).not.toHaveBeenCalled();
  });

  it("never asks whether the number is registered: a taken number gets the same reply, so the form is not an existence oracle", async () => {
    m.phoneTaken.mockResolvedValue(true);
    await startSignUp();
    expect(m.phoneTaken).not.toHaveBeenCalled();
    expect(m.start).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ displayName: "" }, "authPasswordPreview.error.fullNameRequired"],
    [{ username: "1bad" }, "registration.error.usernameShape"],
    [{ accountType: "end_consumer" }, "authPasswordPreview.error.accountTypeRequired"],
    [{ password: "short" }, "authPasswordPreview.error.passwordTooShort"],
    [{ birthDate: "2015-01-01" }, "authPasswordPreview.error.birthDateTooYoung"],
    [{ consent_pilot: "" }, "authPasswordPreview.error.consentRequired"],
  ])("refuses %o before any challenge is opened", async (patch, code) => {
    expect((await requestPhoneSignUp(form(patch), PHONE)).code).toBe(code);
    expect(m.start).not.toHaveBeenCalled();
    expect(m.siteverify).not.toHaveBeenCalled();
  });

  it("refuses a failed challenge, a limited number, a taken username, or the authority's own limits", async () => {
    m.siteverify.mockResolvedValueOnce({ ok: false, reason: "rejected" });
    expect((await requestPhoneSignUp(form(), PHONE)).code).toBe("authPasswordPreview.error.captchaRejected");
    m.limit.mockResolvedValueOnce("limited");
    expect((await requestPhoneSignUp(form(), PHONE)).code).toBe("authPasswordPreview.error.rateLimited");
    m.rpc.mockResolvedValueOnce({ data: false, error: null });
    expect((await requestPhoneSignUp(form(), PHONE)).code).toBe("registration.error.usernameUnavailable");
    expect(m.start).not.toHaveBeenCalled();
    m.start.mockResolvedValueOnce({ status: "rate_limited", retryAfterSeconds: 60 });
    expect((await requestPhoneSignUp(form(), PHONE)).code).toBe("authPasswordPreview.error.rateLimited");
  });

  it("says unavailable - and sets no cookie - when the feature is off or the authority is unavailable", async () => {
    m.service.mockReturnValueOnce(null);
    expect((await requestPhoneSignUp(form(), PHONE)).code).toBe("authPasswordPreview.error.whatsappUnavailable");
    m.start.mockResolvedValueOnce({ status: "unavailable" });
    expect((await requestPhoneSignUp(form(), PHONE)).code).toBe("authPasswordPreview.error.whatsappUnavailable");
    m.service.mockImplementationOnce(() => { throw new Error("misconfigured keyring"); });
    expect((await requestPhoneSignUp(form(), PHONE)).code).toBe("authPasswordPreview.error.sendFailed");
    expect(cookieJar.has("psu")).toBe(false);
  });

  it("fails closed - before any challenge is requested - when the cookie secret is missing or short", async () => {
    for (const bad of [undefined, "short"]) {
      envState.secret = bad;
      expect((await requestPhoneSignUp(form(), PHONE)).code).toBe("authPasswordPreview.error.whatsappUnavailable");
    }
    expect(m.start).not.toHaveBeenCalled();
    expect(cookieJar.has("psu")).toBe(false);
  });

  it("seals the pending sign-up so it is useless without the cookie secret and without this cookie's purpose", async () => {
    await startSignUp();
    const sealed = cookieJar.get("psu")!;
    envState.secret = "another-secret-another-secret-another-secret-0";
    cookieJar.set("psu", sealed);
    expect((await verifyPhoneSignUp(verifyForm("246810"))).code).toBe("authPasswordPreview.error.phoneCodeExpired");
    expect(m.verify).not.toHaveBeenCalled();
    // tampering with one byte is refused too
    envState.secret = "cookie-secret-cookie-secret-cookie-secret-00";
    const raw = Buffer.from(sealed, "base64url");
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 1;
    cookieJar.set("psu", raw.toString("base64url"));
    expect((await verifyPhoneSignUp(verifyForm("246810"))).code).toBe("authPasswordPreview.error.phoneCodeExpired");
  });

  it("never creates a second account for a signed-in person", async () => {
    m.getUser.mockResolvedValueOnce({ data: { user: { id: "someone" } }, error: null });
    expect(await run(() => requestPhoneSignUp(form(), PHONE))).toBe("REDIRECT:/onboarding");
  });
});

describe("verifyPhoneSignUp", () => {
  it("creates the account WITH the grant, initializes it, and attaches the proof last", async () => {
    await startSignUp();
    expect(await run(() => verifyPhoneSignUp(verifyForm("246810")))).toBe("REDIRECT:/onboarding");
    expect(m.verify).toHaveBeenCalledWith(registrationId(), CID, "246810", "203.0.113.9");
    expect(m.createUser).toHaveBeenCalledWith({ grant: expect.objectContaining({ alias: ALIAS, phone: "+201012345678", registrationId: registrationId() }), password: GOOD_PASSWORD, fullName: "Mona Adel", locale: "ar" });
    expect(m.signInWithPassword).toHaveBeenCalledWith({ email: ALIAS, password: GOOD_PASSWORD, options: { captchaToken: "token-b" } });
    expect(m.rpc).toHaveBeenCalledWith("onboarding_select_account_type", { p_track: "business", p_account_type: "supplier" });
    expect(m.rpc).toHaveBeenCalledWith("profile_set_username", { p_username: "mona.adel" });
    expect(m.birthday).toHaveBeenCalledWith("u-new", "1990-05-17");
    expect(m.attach).toHaveBeenCalledWith("u-new", grantFor(registrationId()).id);
    // Order matters: grant -> create user -> profile initialization (phone set) -> attach (phone_verified_at).
    expect(m.order).toEqual(["username_available", "create", "record_consent", "onboarding_select_account_type", "profile_set_phone", "profile_set_username", "profile_set_display_name", "birthday", "attach"]);
    expect(cookieJar.has("psu")).toBe(false);
  });

  it("creates nothing for a wrong, expired or used code, and nothing without a pending sign-up", async () => {
    await startSignUp();
    m.verify.mockResolvedValueOnce({ status: "invalid" });
    expect((await verifyPhoneSignUp(verifyForm("000000"))).code).toBe("authPasswordPreview.error.invalidCode");
    m.verify.mockResolvedValueOnce({ status: "rate_limited", retryAfterSeconds: 60 });
    expect((await verifyPhoneSignUp(verifyForm("000000"))).code).toBe("authPasswordPreview.error.rateLimited");
    m.verify.mockResolvedValueOnce({ status: "unavailable" });
    expect((await verifyPhoneSignUp(verifyForm("000000"))).code).toBe("authPasswordPreview.error.verifyFailed");
    expect((await verifyPhoneSignUp(verifyForm("12345"))).code).toBe("authPasswordPreview.error.invalidCode");
    cookieJar.clear();
    expect((await verifyPhoneSignUp(verifyForm("246810"))).code).toBe("authPasswordPreview.error.phoneCodeExpired");
    expect(m.createUser).not.toHaveBeenCalled();
  });

  it.each([
    ["a grant for a different number", { phone: "+201099999999" }],
    ["a grant for a different alias", { alias: "p201099999999@craftsman-login.aladdin.invalid" }],
    ["a grant for a different registration", { registrationId: "44444444-4444-4444-8444-444444444444" }],
  ])("refuses %s and creates no account", async (_label, over) => {
    await startSignUp();
    m.verify.mockImplementationOnce(async (rid: string) => ({ status: "verified", grant: grantFor(rid, over) }));
    expect((await verifyPhoneSignUp(verifyForm("246810"))).code).toBe("authPasswordPreview.error.verifyFailed");
    expect(m.createUser).not.toHaveBeenCalled();
    expect(cookieJar.has("psu")).toBe(false);
  });

  it("rolls the new account back when the proof cannot be attached, so no unverified phone account survives", async () => {
    await startSignUp();
    m.attach.mockResolvedValueOnce({ status: "invalid" });
    expect((await verifyPhoneSignUp(verifyForm("246810"))).code).toBe("authPasswordPreview.error.verifyFailed");
    expect(m.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(m.deleteUser).toHaveBeenCalledWith("u-new");
    expect(cookieJar.has("psu")).toBe(false);
  });

  it("rolls the new account back when the username was taken meanwhile", async () => {
    await startSignUp();
    m.rpc.mockImplementation(async (name: string) => (name === "profile_set_username" ? { data: null, error: { code: "23505" } } : { data: null, error: null }));
    expect((await verifyPhoneSignUp(verifyForm("246810"))).code).toBe("registration.error.usernameUnavailable");
    expect(m.deleteUser).toHaveBeenCalledWith("u-new");
    expect(m.attach).not.toHaveBeenCalled();
    expect(cookieJar.has("psu")).toBe(false);
  });

  it("tells the person to choose another password when Auth refuses it, leaving no account and no cookie (the grant stays unspent)", async () => {
    await startSignUp();
    m.createUser.mockResolvedValueOnce({ ok: false, reason: "rejected" });
    expect((await verifyPhoneSignUp(verifyForm("246810"))).code).toBe("authPasswordPreview.error.passwordRejected");
    expect(m.signInWithPassword).not.toHaveBeenCalled();
    expect(m.attach).not.toHaveBeenCalled();
    expect(cookieJar.has("psu")).toBe(false);
  });

  it("reports a number taken after the code was sent without creating anything", async () => {
    await startSignUp();
    m.phoneTaken.mockResolvedValueOnce(true);
    expect((await verifyPhoneSignUp(verifyForm("246810"))).code).toBe("authPasswordPreview.error.phoneExists");
    expect(m.createUser).not.toHaveBeenCalled();
  });

  it("keeps the pending sign-up when only the sign-in challenge failed, so Resend can recover", async () => {
    await startSignUp();
    m.signInWithPassword.mockResolvedValueOnce({ error: { code: "captcha_failed", message: "captcha protection: request disallowed" } });
    expect((await verifyPhoneSignUp(verifyForm("246810"))).code).toBe("authPasswordPreview.error.captchaRejected");
    expect(m.deleteUser).toHaveBeenCalledWith("u-new");
    expect(cookieJar.has("psu")).toBe(true);
  });
});

describe("resendPhoneSignUpCode", () => {
  it("asks the authority for a fresh challenge for the SAME registration and tracks the new challenge id", async () => {
    await startSignUp();
    const rid = registrationId();
    m.start.mockResolvedValueOnce({ status: "sent", challengeId: CID2, expiresAt: "x", resendAvailableAt: "y" });
    const data = new FormData();
    data.set("captchaToken", "token-c");
    expect(await resendPhoneSignUpCode(data)).toMatchObject({ ok: true });
    expect(m.siteverify).toHaveBeenLastCalledWith("token-c", expect.objectContaining({ expectedAction: "sign-up-resend" }));
    expect(m.start).toHaveBeenLastCalledWith(rid, "+201012345678", "203.0.113.9", "ar");
    expect(await run(() => verifyPhoneSignUp(verifyForm("246810")))).toBe("REDIRECT:/onboarding");
    expect(m.verify).toHaveBeenLastCalledWith(rid, CID2, "246810", "203.0.113.9");
  });

  it("surfaces the authority's cooldown and asks to start again without a pending sign-up", async () => {
    await startSignUp();
    m.start.mockResolvedValueOnce({ status: "rate_limited", retryAfterSeconds: 30 });
    expect((await resendPhoneSignUpCode(new FormData())).code).toBe("authPasswordPreview.error.rateLimited");
    cookieJar.clear();
    expect((await resendPhoneSignUpCode(new FormData())).code).toBe("authPasswordPreview.error.phoneCodeExpired");
  });
});
