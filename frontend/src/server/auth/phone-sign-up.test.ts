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
vi.mock("@/lib/env", () => ({ readAuthIdentifierSecret: () => "test-secret-test-secret-test-secret-00" }));

const m = vi.hoisted(() => ({
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  rpc: vi.fn(),
  siteverify: vi.fn(),
  limit: vi.fn(),
  send: vi.fn(),
  phoneTaken: vi.fn(),
  countRecent: vi.fn(),
  insert: vi.fn(),
  remove: vi.fn(),
  load: vi.fn(),
  attempt: vi.fn(),
  consume: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  birthday: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: async () => ({ auth: { getUser: m.getUser, signInWithPassword: m.signInWithPassword, signOut: m.signOut }, rpc: m.rpc }),
}));
vi.mock("@/server/auth/turnstile", () => ({ verifyTurnstileToken: m.siteverify, clientIpFrom: () => null, turnstileHostnamesFrom: () => [] }));
vi.mock("@/server/auth/phone-auth-limit", () => ({ phoneAuthLimit: m.limit }));
vi.mock("@/server/auth/whatsapp-otp", () => ({ sendWhatsAppCode: m.send }));
vi.mock("@/lib/supabase/admin-server", () => ({
  isCanonicalPhoneTaken: m.phoneTaken,
  countRecentPhoneChallenges: m.countRecent,
  insertPhoneChallenge: m.insert,
  deletePhoneChallenge: m.remove,
  loadPhoneChallenge: m.load,
  recordPhoneChallengeAttempt: m.attempt,
  consumePhoneChallenge: m.consume,
  createPhoneSignUpUser: m.createUser,
  deleteCraftsmanPasswordUser: m.deleteUser,
  saveVerifiedBirthDate: m.birthday,
}));

import { requestPhoneSignUp, resendPhoneSignUpCode, verifyPhoneSignUp } from "./phone-sign-up";
import { parsePhone } from "@/features/installer-phone-auth/validation";

const PHONE = (parsePhone("01012345678") as { ok: true; value: Parameters<typeof requestPhoneSignUp>[1] }).value;
const GOOD_PASSWORD = "a-long-and-unusual-passphrase";

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

/** The code the server generated, as handed to the WhatsApp sender. */
const sentCode = () => m.send.mock.calls.at(-1)?.[1] as string;
const insertedRow = () => m.insert.mock.calls.at(-1)?.[0] as { id: string; codeHash: string; expiresAt: string };

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.clear();
  m.getUser.mockResolvedValue({ data: { user: null }, error: null });
  m.siteverify.mockResolvedValue({ ok: true });
  m.limit.mockResolvedValue("allowed");
  m.send.mockResolvedValue("sent");
  m.phoneTaken.mockResolvedValue(false);
  m.countRecent.mockResolvedValue(0);
  m.insert.mockResolvedValue(undefined);
  m.remove.mockResolvedValue(undefined);
  m.attempt.mockResolvedValue(true);
  m.consume.mockResolvedValue(true);
  m.createUser.mockResolvedValue({ ok: true, userId: "u-new" });
  m.deleteUser.mockResolvedValue(true);
  m.birthday.mockResolvedValue(undefined);
  m.signInWithPassword.mockResolvedValue({ error: null });
  m.signOut.mockResolvedValue({ error: null });
  m.rpc.mockImplementation(async (name: string) => (name === "username_available" ? { data: true, error: null } : { data: null, error: null }));
});

async function startSignUp() {
  const res = await requestPhoneSignUp(form(), PHONE);
  expect(res).toMatchObject({ ok: true, channel: "phone", code: "authPasswordPreview.info.whatsappCodeSent" });
  const row = insertedRow();
  m.load.mockResolvedValue({ id: row.id, phoneE164: "+201012345678", codeHash: row.codeHash, attempts: 0, expiresAt: row.expiresAt, consumedAt: null });
  return sentCode();
}

const verifyForm = (token: string) => {
  const data = new FormData();
  data.set("token", token);
  data.set("captchaToken", "token-b");
  return data;
};

describe("requestPhoneSignUp", () => {
  it("checks every field, Turnstile, the limiter, the number and the username, then sends a 6-digit WhatsApp code", async () => {
    const code = await startSignUp();
    expect(code).toMatch(/^\d{6}$/);
    expect(m.siteverify).toHaveBeenCalledWith("token-a", expect.objectContaining({ expectedAction: "sign-up" }));
    expect(m.send).toHaveBeenCalledWith("+201012345678", code, "ar");
    // Only an HMAC of the code is stored, keyed by the challenge id.
    const row = insertedRow();
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.codeHash).not.toContain(code);
    // The sealed cookie never carries the password in the clear.
    const sealed = cookieJar.get("psu") ?? "";
    expect(sealed).not.toContain(GOOD_PASSWORD);
    expect(Buffer.from(sealed, "base64url").toString("utf8")).not.toContain(GOOD_PASSWORD);
    expect(m.createUser).not.toHaveBeenCalled();
  });

  it.each([
    [{ displayName: "" }, "authPasswordPreview.error.fullNameRequired"],
    [{ username: "1bad" }, "registration.error.usernameShape"],
    [{ accountType: "end_consumer" }, "authPasswordPreview.error.accountTypeRequired"],
    [{ password: "short" }, "authPasswordPreview.error.passwordTooShort"],
    [{ birthDate: "2015-01-01" }, "authPasswordPreview.error.birthDateTooYoung"],
    [{ consent_pilot: "" }, "authPasswordPreview.error.consentRequired"],
  ])("refuses %o before any code is sent", async (patch, code) => {
    expect((await requestPhoneSignUp(form(patch), PHONE)).code).toBe(code);
    expect(m.send).not.toHaveBeenCalled();
    expect(m.siteverify).not.toHaveBeenCalled();
  });

  it("refuses a failed challenge, a limited number, a taken number or username, or too many codes", async () => {
    m.siteverify.mockResolvedValueOnce({ ok: false, reason: "rejected" });
    expect((await requestPhoneSignUp(form(), PHONE)).code).toBe("authPasswordPreview.error.captchaRejected");
    m.limit.mockResolvedValueOnce("limited");
    expect((await requestPhoneSignUp(form(), PHONE)).code).toBe("authPasswordPreview.error.rateLimited");
    m.phoneTaken.mockResolvedValueOnce(true);
    expect((await requestPhoneSignUp(form(), PHONE)).code).toBe("authPasswordPreview.error.phoneExists");
    m.rpc.mockResolvedValueOnce({ data: false, error: null });
    expect((await requestPhoneSignUp(form(), PHONE)).code).toBe("registration.error.usernameUnavailable");
    m.countRecent.mockResolvedValueOnce(5);
    expect((await requestPhoneSignUp(form(), PHONE)).code).toBe("authPasswordPreview.error.rateLimited");
    expect(m.send).not.toHaveBeenCalled();
  });

  it("drops the stored code when WhatsApp cannot deliver it", async () => {
    m.send.mockResolvedValueOnce("unavailable");
    expect((await requestPhoneSignUp(form(), PHONE)).code).toBe("authPasswordPreview.error.whatsappUnavailable");
    expect(m.remove).toHaveBeenCalledWith(insertedRow().id);
    expect(cookieJar.has("psu")).toBe(false);
  });

  it("never creates a second account for a signed-in person", async () => {
    m.getUser.mockResolvedValueOnce({ data: { user: { id: "someone" } }, error: null });
    expect(await run(() => requestPhoneSignUp(form(), PHONE))).toBe("REDIRECT:/onboarding");
  });
});

describe("verifyPhoneSignUp", () => {
  it("creates, signs in and sets up the account only after the right code", async () => {
    const code = await startSignUp();
    expect(await run(() => verifyPhoneSignUp(verifyForm(code)))).toBe("REDIRECT:/onboarding");
    expect(m.attempt).toHaveBeenCalledWith(insertedRow().id, 0);
    expect(m.consume).toHaveBeenCalledWith(insertedRow().id);
    expect(m.createUser).toHaveBeenCalledWith({ loginAlias: "p201012345678@craftsman-login.aladdin.invalid", password: GOOD_PASSWORD, fullName: "Mona Adel", locale: "ar" });
    expect(m.signInWithPassword).toHaveBeenCalledWith({ email: "p201012345678@craftsman-login.aladdin.invalid", password: GOOD_PASSWORD, options: { captchaToken: "token-b" } });
    expect(m.rpc.mock.calls.map(([name]) => name)).toEqual([
      "username_available", "record_consent", "onboarding_select_account_type", "profile_set_phone", "profile_set_username", "profile_set_display_name",
    ]);
    expect(m.rpc).toHaveBeenCalledWith("onboarding_select_account_type", { p_track: "business", p_account_type: "supplier" });
    expect(m.rpc).toHaveBeenCalledWith("profile_set_username", { p_username: "mona.adel" });
    expect(m.birthday).toHaveBeenCalledWith("u-new", "1990-05-17");
    expect(cookieJar.has("psu")).toBe(false);
  });

  it("counts a wrong code and creates nothing", async () => {
    const code = await startSignUp();
    const wrong = code === "000000" ? "111111" : "000000";
    expect((await verifyPhoneSignUp(verifyForm(wrong))).code).toBe("authPasswordPreview.error.invalidCode");
    expect(m.attempt).toHaveBeenCalledTimes(1);
    expect(m.consume).not.toHaveBeenCalled();
    expect(m.createUser).not.toHaveBeenCalled();
  });

  it("refuses an expired, used or exhausted code, and a missing pending sign-up", async () => {
    const code = await startSignUp();
    const row = insertedRow();
    for (const patch of [{ attempts: 5 }, { consumedAt: new Date().toISOString() }, { expiresAt: new Date(Date.now() - 1000).toISOString() }]) {
      m.load.mockResolvedValueOnce({ id: row.id, phoneE164: "+201012345678", codeHash: row.codeHash, attempts: 0, expiresAt: row.expiresAt, consumedAt: null, ...patch });
      expect((await verifyPhoneSignUp(verifyForm(code))).code).toBe("authPasswordPreview.error.phoneCodeExpired");
    }
    cookieJar.clear();
    expect((await verifyPhoneSignUp(verifyForm(code))).code).toBe("authPasswordPreview.error.phoneCodeExpired");
    expect(m.createUser).not.toHaveBeenCalled();
  });

  it("loses a guess raced by another request instead of checking it twice", async () => {
    const code = await startSignUp();
    m.attempt.mockResolvedValueOnce(false);
    expect((await verifyPhoneSignUp(verifyForm(code))).code).toBe("authPasswordPreview.error.invalidCode");
    expect(m.consume).not.toHaveBeenCalled();
  });

  it("rolls the new account back when the username was taken meanwhile", async () => {
    const code = await startSignUp();
    m.rpc.mockImplementation(async (name: string) => (name === "profile_set_username" ? { data: null, error: { code: "23505" } } : { data: null, error: null }));
    expect((await verifyPhoneSignUp(verifyForm(code))).code).toBe("registration.error.usernameUnavailable");
    expect(m.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(m.deleteUser).toHaveBeenCalledWith("u-new");
    expect(cookieJar.has("psu")).toBe(false);
  });

  it("keeps the pending sign-up when only the sign-in challenge failed, so Resend can recover", async () => {
    const code = await startSignUp();
    m.signInWithPassword.mockResolvedValueOnce({ error: { code: "captcha_failed", message: "captcha protection: request disallowed" } });
    expect((await verifyPhoneSignUp(verifyForm(code))).code).toBe("authPasswordPreview.error.captchaRejected");
    expect(m.deleteUser).toHaveBeenCalledWith("u-new");
    expect(cookieJar.has("psu")).toBe(true);
  });
});

describe("resendPhoneSignUpCode", () => {
  it("issues a fresh code for the same pending sign-up and retires the old one", async () => {
    await startSignUp();
    const first = insertedRow().id;
    const data = new FormData();
    data.set("captchaToken", "token-c");
    expect(await resendPhoneSignUpCode(data)).toMatchObject({ ok: true });
    expect(m.siteverify).toHaveBeenLastCalledWith("token-c", expect.objectContaining({ expectedAction: "sign-up-resend" }));
    expect(insertedRow().id).not.toBe(first);
    expect(m.remove).toHaveBeenCalledWith(first);
  });

  it("asks to start again without a pending sign-up", async () => {
    expect((await resendPhoneSignUpCode(new FormData())).code).toBe("authPasswordPreview.error.phoneCodeExpired");
  });
});
