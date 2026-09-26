import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

const cookieStore = new Map<string, string>();
const cookiesApi = {
  get: vi.fn((name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name) } : undefined)),
  set: vi.fn((name: string, value: string) => {
    cookieStore.set(name, value);
  }),
  delete: vi.fn((arg: string | { name: string }) => {
    cookieStore.delete(typeof arg === "string" ? arg : arg.name);
  }),
};
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookiesApi),
  headers: vi.fn(async () => ({
    get: (name: string) => (name === "host" ? "127.0.0.1:3000" : null),
  })),
}));

// --- The normal, cookie-backed client (getServerSupabase()) ----------------
const signInWithOtp = vi.fn();
const signUp = vi.fn();
const resend = vi.fn();
const verifyOtp = vi.fn();
const updateUser = vi.fn();
const signInWithPassword = vi.fn();
const signOut = vi.fn();
const getUser = vi.fn();
const reauthenticate = vi.fn();
const rpc = vi.fn();
const { resolveActiveLanding } = vi.hoisted(() => ({
  resolveActiveLanding: vi.fn(),
}));
const supabase = {
  auth: { signInWithOtp, signUp, resend, verifyOtp, updateUser, signInWithPassword, getUser, signOut, reauthenticate },
  rpc,
};

// --- The ISOLATED client (createIsolatedAuthClient()) — the ENTIRE recovery
// flow, Screens 1-3, all share this same factory in the real code (never the
// cookie-backed `getServerSupabase()`). Screen 3 hydrates a fresh call to
// this factory with `setSession()` before `updateUser`/`signOut`, since
// GoTrue SDK auth methods read the calling client's own in-memory session,
// not a bare Authorization header (see recovery-grant.ts's doc comment).
const isolatedVerifyOtp = vi.fn();
const isolatedResetPasswordForEmail = vi.fn();
const isolatedSetSession = vi.fn();
const isolatedUpdateUser = vi.fn();
const isolatedSignOut = vi.fn();
const isolatedClient = {
  auth: {
    verifyOtp: isolatedVerifyOtp,
    resetPasswordForEmail: isolatedResetPasswordForEmail,
    setSession: isolatedSetSession,
    updateUser: isolatedUpdateUser,
    signOut: isolatedSignOut,
  },
};

vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: vi.fn(async () => supabase),
}));
vi.mock("@/server/queries/landing", () => ({
  resolveActiveLanding,
}));

const markPasswordAttachedAuthoritatively = vi.fn();
const savePendingRegistration = vi.fn();
// Inlined literal (not a shared const) — referencing an outer const directly inside a
// hoisted vi.mock factory hits the TDZ, since the factory runs before the const initializes.
vi.mock("@/lib/supabase/admin-server", () => ({
  markPasswordAttachedAuthoritatively: (...args: unknown[]) => markPasswordAttachedAuthoritatively(...args),
  savePendingRegistration: (...args: unknown[]) => savePendingRegistration(...args),
  PASSWORD_SET_FLAG: "aladdin_pw_preview_password_set",
}));
const PASSWORD_SET_FLAG = "aladdin_pw_preview_password_set";

// Fake, deterministic "encryption" — the real AEAD primitives have their own
// dedicated test file (recovery-grant.test.ts). Here we only need round-trip
// and null-on-missing/garbage semantics so the ACTIONS' own logic is what's
// under test, not the crypto.
type TestGrant = { email: string; accessToken: string; refreshToken: string; exp: number };
const createIsolatedAuthClient = vi.fn(() => isolatedClient);
const encryptRecoveryGrant = vi.fn((grant: TestGrant) => JSON.stringify(grant));
const decryptRecoveryGrant = vi.fn((token: string | undefined) => {
  if (!token) return null;
  try {
    const grant = JSON.parse(token) as TestGrant;
    if (grant.exp < Date.now()) return null;
    return grant;
  } catch {
    return null;
  }
});
vi.mock("@/lib/supabase/recovery-grant", () => ({
  createIsolatedAuthClient: () => createIsolatedAuthClient(),
  encryptRecoveryGrant: (...args: [TestGrant]) => encryptRecoveryGrant(...args),
  decryptRecoveryGrant: (...args: [string | undefined]) => decryptRecoveryGrant(...args),
  RECOVERY_GRANT_TTL_SECONDS: 300,
}));

import {
  requestPasswordSignUp,
  resendPasswordSignUpCode,
  verifyPasswordSignUp,
  migrationEligibility,
  passwordSignIn,
  requestRecoveryCode,
  recoveryFlowEmail,
  verifyRecoveryCode,
  resendRecoveryCode,
  requireRecoverySession,
  resetPasswordAndSignOut,
  consumeRecoverySuccess,
  requestMigrationCode,
  completeMigration,
  changePassword,
} from "./auth-password-preview";
import { PASSWORD_MIN_LENGTH } from "@/features/auth-password-preview/password-policy";

// Genuinely strong: long, varied, no dictionary word, no repeated/sequential run, unrelated to any test email.
const GOOD_PASSWORD = "Zq9$Kx4#WmT7!Pn2";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

function consented(entries: Record<string, string> = {}) {
  return fd({
    consent_terms: "on",
    consent_privacy: "on",
    consent_pilot: "on",
    captchaToken: "test-captcha-token",
    username: "validuser123",
    accountType: "installer_technician",
    ...entries,
  });
}

/** For requestRecoveryCode — a Turnstile token is the only new requirement there. */
function withCaptcha(entries: Record<string, string> = {}) {
  return fd({ captchaToken: "test-captcha-token", ...entries });
}

/** Seeds a valid, unexpired recovery grant cookie the way `verifyRecoveryCode` would. */
function seedRecoveryGrant(email: string, accessToken = "isolated-access-token", refreshToken = "isolated-refresh-token") {
  cookieStore.set("pwr_grant", JSON.stringify({ email, accessToken, refreshToken, exp: Date.now() + 300_000 }));
}

// Cloudflare Siteverify, mocked at the network boundary so the REAL
// server/auth/turnstile.ts helper runs in every action test. Default: pass.
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const fetchMock = vi.fn();
function siteverifyReplies(body: unknown, status = 200) {
  // A fresh Response per call — a body can only be read once.
  fetchMock.mockImplementation(async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}
function siteverifyCalls() {
  return fetchMock.mock.calls.filter(([url]) => String(url) === SITEVERIFY_URL);
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.clear();
  resolveActiveLanding.mockResolvedValue("/b2b");
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("TURNSTILE_SECRET_KEY", "test-turnstile-secret");
  siteverifyReplies({ success: true });
  // Default DB answers: the username pre-flight says "available"; every other
  // RPC succeeds with no data. Individual tests override.
  rpc.mockImplementation(async (fn: string) =>
    fn === "username_available" ? { data: true, error: null } : { data: null, error: null },
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("10-character minimum enforced everywhere", () => {
  it("PASSWORD_MIN_LENGTH is exactly 10", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
  });

  it("supabase/config.toml's minimum_password_length matches PASSWORD_MIN_LENGTH", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const configPath = path.resolve(process.cwd(), "..", "supabase", "config.toml");
    const config = fs.readFileSync(configPath, "utf8");
    const match = config.match(/^minimum_password_length\s*=\s*(\d+)/m);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(PASSWORD_MIN_LENGTH);
  });

  it("rejects a 9-character password at registration", async () => {
    const res = await requestPasswordSignUp(
      { ok: false },
      consented({ email: "person@example.test", password: "a".repeat(9), confirmPassword: "a".repeat(9) }),
    );
    expect(res.ok).toBe(false);
    expect(res.code).toBe("authPasswordPreview.error.passwordTooShort");
  });

  it("accepts a 10-character (non-weak) password at registration", async () => {
    signUp.mockResolvedValueOnce({ error: null });
    const pw = "Xk7#mLp2Qz"; // 10 chars, not common/sequential/account-related
    const res = await requestPasswordSignUp(
      { ok: false },
      consented({ email: "person@example.test", password: pw, confirmPassword: pw }),
    );
    expect(res.ok).toBe(true);
  });
});

describe("weak-password rejection", () => {
  it("rejects a common password even at 10+ characters", async () => {
    const res = await requestPasswordSignUp(
      { ok: false },
      consented({ email: "person@example.test", password: "iloveyou12345", confirmPassword: "iloveyou12345" }),
    );
    expect(res.ok).toBe(false);
    expect(res.code).toBe("authPasswordPreview.error.passwordCommon");
    expect(signUp).not.toHaveBeenCalled();
  });

  it("rejects a sequential/repetitive password", async () => {
    const res = await requestPasswordSignUp(
      { ok: false },
      consented({ email: "person@example.test", password: "abcdefghij1234", confirmPassword: "abcdefghij1234" }),
    );
    expect(res.ok).toBe(false);
    expect(res.code).toBe("authPasswordPreview.error.passwordSequential");
  });

  it("rejects a password derived from the account's own email", async () => {
    const res = await requestPasswordSignUp(
      { ok: false },
      consented({ email: "ahmedhassan@example.test", password: "ahmedhassan99!", confirmPassword: "ahmedhassan99!" }),
    );
    expect(res.ok).toBe(false);
    expect(res.code).toBe("authPasswordPreview.error.passwordAccountRelated");
  });
});

describe("requestPasswordSignUp (Architecture B — signUp() sets the password atomically)", () => {
  it("rejects a mismatched password confirmation", async () => {
    const res = await requestPasswordSignUp(
      { ok: false },
      consented({ email: "person@example.test", password: GOOD_PASSWORD, confirmPassword: "a-totally-different-value" }),
    );
    expect(res.code).toBe("authPasswordPreview.error.passwordMismatch");
    expect(signUp).not.toHaveBeenCalled();
  });

  it("requires all three consents", async () => {
    const res = await requestPasswordSignUp(
      { ok: false },
      fd({ email: "person@example.test", username: "validuser123", accountType: "installer_technician", password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD, consent_terms: "on" }),
    );
    expect(res.code).toBe("authPasswordPreview.error.consentRequired");
    expect(signUp).not.toHaveBeenCalled();
  });

  it("submits email AND password directly to signUp() in one call", async () => {
    signUp.mockResolvedValueOnce({ error: null });
    const res = await requestPasswordSignUp(
      { ok: false },
      consented({ email: "new-person@example.test", password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD }),
    );
    expect(res.ok).toBe(true);
    // The token is verified by the APP, never forwarded to Supabase Auth.
    expect(signUp).toHaveBeenCalledWith({
      email: "new-person@example.test",
      password: GOOD_PASSWORD,
    });
    // Never the passwordless OTP endpoint — Architecture B never calls it.
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("refuses without a captcha token — never calls signUp", async () => {
    const res = await requestPasswordSignUp(
      { ok: false },
      fd({ consent_terms: "on", consent_privacy: "on", consent_pilot: "on", email: "person@example.test", username: "validuser123", accountType: "installer_technician", password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD }),
    );
    expect(res.code).toBe("authPasswordPreview.error.captchaRequired");
    expect(signUp).not.toHaveBeenCalled();
    expect(siteverifyCalls()).toHaveLength(0);
  });

  it("verifies the token with Cloudflare Siteverify (POST, secret + response) BEFORE signUp", async () => {
    signUp.mockResolvedValueOnce({ error: null });
    await requestPasswordSignUp(
      { ok: false },
      consented({ email: "new-person@example.test", password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD }),
    );
    const calls = siteverifyCalls();
    expect(calls).toHaveLength(1);
    const init = calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("secret")).toBe("test-turnstile-secret");
    expect(body.get("response")).toBe("test-captcha-token");
    expect(fetchMock.mock.invocationCallOrder[0]!).toBeLessThan(signUp.mock.invocationCallOrder[0]!);
  });

  it.each([
    ["a fake/invalid token (success:false)", () => siteverifyReplies({ success: false, "error-codes": ["invalid-input-response"] })],
    ["a replayed token (timeout-or-duplicate)", () => siteverifyReplies({ success: false, "error-codes": ["timeout-or-duplicate"] })],
    ["a truthy-but-not-true success", () => siteverifyReplies({ success: "true" })],
    ["a malformed response", () => fetchMock.mockImplementation(async () => new Response("<html>", { status: 200 }))],
    ["a non-2xx response", () => siteverifyReplies({ success: true }, 500)],
    ["a network failure", () => fetchMock.mockRejectedValue(new TypeError("fetch failed"))],
    ["a timeout", () => fetchMock.mockRejectedValue(new DOMException("aborted", "TimeoutError"))],
  ])("fails closed on %s — neutral captchaRejected, signUp never runs, no Cloudflare detail leaks", async (_label, arrange) => {
    arrange();
    const res = await requestPasswordSignUp(
      { ok: false },
      consented({ email: "person@example.test", password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD }),
    );
    expect(res.ok).toBe(false);
    expect(res.code).toBe("authPasswordPreview.error.captchaRejected");
    expect(JSON.stringify(res)).not.toMatch(/invalid-input|timeout-or-duplicate|test-turnstile-secret/);
    expect(signUp).not.toHaveBeenCalled();
    expect(savePendingRegistration).not.toHaveBeenCalled();
  });

  it("fails closed outside local dev when no TURNSTILE_SECRET_KEY is configured — Cloudflare is never even called", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "staging");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    const res = await requestPasswordSignUp(
      { ok: false },
      consented({ email: "person@example.test", password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD }),
    );
    expect(res.code).toBe("authPasswordPreview.error.captchaRejected");
    expect(siteverifyCalls()).toHaveLength(0);
    expect(signUp).not.toHaveBeenCalled();
  });

  it("a genuine unexpected failure surfaces the generic sendFailed code, never a distinguishing one", async () => {
    signUp.mockResolvedValueOnce({ error: { message: "network blip" } });
    const res = await requestPasswordSignUp(
      { ok: false },
      consented({ email: "person@example.test", password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD }),
    );
    expect(res.code).toBe("authPasswordPreview.error.sendFailed");
  });

  describe("account-enumeration normalization (§Account enumeration)", () => {
    it("an existing, CONFIRMED account (signUp() returns user_already_exists) gets the EXACT SAME success response as a genuine new registration — never a distinguishing message", async () => {
      signUp.mockResolvedValueOnce({ error: { code: "user_already_exists", status: 422 } });
      const existing = await requestPasswordSignUp(
        { ok: false },
        consented({ email: "already-has-account@example.test", password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD }),
      );

      signUp.mockResolvedValueOnce({ error: null });
      const fresh = await requestPasswordSignUp(
        { ok: false },
        consented({ email: "genuinely-new@example.test", password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD }),
      );

      expect(existing.ok).toBe(true);
      expect(existing.code).toBe(fresh.code);
      expect(existing.ok).toBe(fresh.ok);
    });

    it("also normalizes GoTrue's alternate `email_exists` error code the same way", async () => {
      signUp.mockResolvedValueOnce({ error: { code: "email_exists", status: 422 } });
      const res = await requestPasswordSignUp(
        { ok: false },
        consented({ email: "already-has-account@example.test", password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD }),
      );
      expect(res.ok).toBe(true);
      expect(res.code).toBe("authPasswordPreview.info.codeSent");
    });

    it("a rate limit is still allowed to differ from the enumeration-safe response (never reveals existence, just an abuse signal)", async () => {
      signUp.mockResolvedValueOnce({ error: { status: 429 } });
      const res = await requestPasswordSignUp(
        { ok: false },
        consented({ email: "person@example.test", password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD }),
      );
      expect(res.code).toBe("authPasswordPreview.error.rateLimited");
    });
  });
});

describe("requestPasswordSignUp — account type is resolved on the SERVER, never trusted from the client", () => {
  it.each(["end_consumer", "engineer", "contractor", "organization_owner_manager", "wholesaler", "interior_designer", "not_a_type"])(
    "refuses %s (Coming Soon / transitional / not offered) before signUp() or any staging",
    async (accountType) => {
      const res = await requestPasswordSignUp(
        { ok: false },
        consented({ email: "person@example.test", password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD, accountType }),
      );
      expect(res.ok).toBe(false);
      expect(signUp).not.toHaveBeenCalled();
      expect(savePendingRegistration).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["installer_technician", "persona_type", "installer_technician"],
    ["salesperson", "persona_type", "sales"],
    ["showroom_dealer", "organization_type", "showroom_dealer"],
    ["supplier", "organization_type", "supplier"],
    ["manufacturer", "organization_type", "manufacturer"],
    ["importer", "organization_type", "importer"],
  ])("stages %s as %s=%s from the server-side catalog", async (accountType, audienceKind, audienceValue) => {
    signUp.mockResolvedValueOnce({ error: null, data: { user: { id: "new-user-id" } } });
    const res = await requestPasswordSignUp(
      { ok: false },
      consented({ email: "new-person@example.test", password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD, accountType }),
    );
    expect(res.ok).toBe(true);
    expect(savePendingRegistration).toHaveBeenCalledWith({
      userId: "new-user-id",
      username: "validuser123",
      audienceKind,
      audienceValue,
    });
  });
});

describe("requestPasswordSignUp — username pre-flight BEFORE signUp() (no Auth user, no email)", () => {
  function submit(username = "validuser123") {
    return requestPasswordSignUp(
      { ok: false },
      consented({ email: "new-person@example.test", username, password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD }),
    );
  }
  function availability(answer: { data: unknown; error: unknown }) {
    rpc.mockImplementation(async (fn: string) => (fn === "username_available" ? answer : { data: null, error: null }));
  }

  it("asks the authoritative username_available RPC with the submitted username", async () => {
    signUp.mockResolvedValueOnce({ error: null, data: { user: { id: "u-new" } } });
    await submit("freshname42");
    expect(rpc).toHaveBeenCalledWith("username_available", { p_username: "freshname42" });
    expect(rpc.mock.invocationCallOrder[0]!).toBeLessThan(signUp.mock.invocationCallOrder[0]!);
  });

  it("an unavailable username stays on Step 1 with the neutral error — signUp() never runs, nothing is staged", async () => {
    availability({ data: false, error: null });
    const res = await submit("takenname");
    expect(res).toEqual({ ok: false, code: "registration.error.usernameUnavailable", email: "new-person@example.test" });
    expect(signUp).not.toHaveBeenCalled();
    expect(savePendingRegistration).not.toHaveBeenCalled();
  });

  it("reserved and taken usernames get the IDENTICAL response (the RPC answers false for both)", async () => {
    availability({ data: false, error: null });
    const reserved = await submit("admin");
    const taken = await submit("takenname");
    expect(reserved).toEqual(taken);
    expect(JSON.stringify(reserved)).not.toMatch(/reserved/i);
  });

  it.each([
    ["an RPC error", { data: null, error: { code: "PGRST000", message: "boom" } }],
    ["a non-boolean answer", { data: null, error: null }],
  ])("%s is a neutral retry — never 'unavailable', never signUp()", async (_label, answer) => {
    availability(answer);
    const res = await submit();
    expect(res.code).toBe("authPasswordPreview.error.sendFailed");
    expect(signUp).not.toHaveBeenCalled();
  });

  it("runs only after the CAPTCHA gate — a rejected token never reaches the DB", async () => {
    siteverifyReplies({ success: false });
    const res = await submit();
    expect(res.code).toBe("authPasswordPreview.error.captchaRejected");
    expect(rpc).not.toHaveBeenCalledWith("username_available", expect.anything());
  });
});

describe("verifyPasswordSignUp — the post-OTP username claim is never ignored", () => {
  function stage(
    usernameResult: { data: unknown; error: unknown },
    accountTypeResult: { data: unknown; error: unknown } = { data: null, error: null },
  ) {
    verifyOtp.mockResolvedValueOnce({ error: null, data: { user: { id: "u1", email: "person@example.test" } } });
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "pending_registration_consume")
        return { data: [{ username: "staged_name", audience_kind: "persona_type", audience_value: "installer_technician" }], error: null };
      if (fn === "onboarding_select_account_type") return accountTypeResult;
      if (fn === "profile_set_username") return usernameResult;
      if (fn === "my_registration_state") return { data: "access_ready", error: null };
      return { data: null, error: null };
    });
  }
  const verify = () => verifyPasswordSignUp({ ok: false }, fd({ email: "person@example.test", token: "123456" }));

  it("a 23505 collision keeps the session and account type and routes to the explicit recovery screen", async () => {
    stage({ data: null, error: { code: "23505", message: "username is unavailable" } });
    await expect(verify()).rejects.toThrow("REDIRECT:/preview/auth-password/finish-registration?reason=username_unavailable");
    expect(rpc).toHaveBeenCalledWith("onboarding_select_account_type", { p_track: "professional", p_account_type: "installer_technician" });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("any other claim failure is not treated as success: safe log (no username), then the state-derived recovery screen", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    stage({ data: null, error: { code: "XX000", message: "internal" } });
    await expect(verify()).rejects.toThrow(/^REDIRECT:\/preview\/auth-password\/finish-registration$/);
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]![0]);
    expect(line).toContain("XX000");
    expect(line).not.toMatch(/staged_name|person@example\.test|123456/);
    log.mockRestore();
  });

  it("an account-type failure is not ignored either — the recovery screen asks for what is missing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    stage({ data: null, error: null }, { data: null, error: { code: "22023", message: "x" } });
    await expect(verify()).rejects.toThrow(/^REDIRECT:\/preview\/auth-password\/finish-registration$/);
    log.mockRestore();
  });

  it("the golden path (claim succeeds) is unchanged — straight into the app", async () => {
    stage({ data: null, error: null });
    await expect(verify()).rejects.toThrow(/^REDIRECT:\/onboarding/);
    expect(rpc).toHaveBeenCalledWith("profile_set_username", { p_username: "staged_name" });
  });
});

describe("verifyPasswordSignUp — applies the staged account type through the authoritative RPC", () => {
  it.each([
    ["persona_type", "installer_technician", "professional"],
    ["persona_type", "sales", "professional"],
    ["organization_type", "importer", "business"],
  ])("%s=%s → onboarding_select_account_type(%s) then profile_set_username", async (audienceKind, audienceValue, track) => {
    verifyOtp.mockResolvedValueOnce({ error: null, data: { user: { id: "u1", email: "person@example.test" } } });
    rpc.mockImplementation(async (fn: string) =>
      fn === "pending_registration_consume"
        ? { data: [{ username: "staged_name", audience_kind: audienceKind, audience_value: audienceValue }], error: null }
        : fn === "my_registration_state"
          ? { data: "access_ready", error: null }
          : { data: null, error: null },
    );
    await expect(
      verifyPasswordSignUp({ ok: false }, fd({ email: "person@example.test", token: "123456" })),
    ).rejects.toThrow(/REDIRECT:/);
    const calls = rpc.mock.calls.map((c) => c[0]);
    expect(calls.indexOf("onboarding_select_account_type")).toBeGreaterThan(calls.indexOf("pending_registration_consume"));
    expect(rpc).toHaveBeenCalledWith("onboarding_select_account_type", { p_track: track, p_account_type: audienceValue });
    expect(rpc).toHaveBeenCalledWith("profile_set_username", { p_username: "staged_name" });
    // No client-side persona or membership write exists — the RPC is the only authority.
    expect(calls).not.toContain("individual_save_professional");
    expect(calls).not.toContain("business_draft_submit");
  });
});

describe("resendPasswordSignUpCode — never re-submits the password, never re-registers", () => {
  it("resends via GoTrue's resend({type:'signup'}) with just the email — no password field exists on this action's input at all", async () => {
    resend.mockResolvedValueOnce({ error: null });
    const res = await resendPasswordSignUpCode({ ok: false }, withCaptcha({ email: "person@example.test" }));
    expect(res.ok).toBe(true);
    expect(resend).toHaveBeenCalledWith({
      type: "signup",
      email: "person@example.test",
    });
    expect(siteverifyCalls()).toHaveLength(1);
    // Never signUp() again — resend must not re-create the account or re-set the password.
    expect(signUp).not.toHaveBeenCalled();
  });

  it("refuses without a captcha token", async () => {
    const res = await resendPasswordSignUpCode({ ok: false }, fd({ email: "person@example.test" }));
    expect(res.code).toBe("authPasswordPreview.error.captchaRequired");
    expect(resend).not.toHaveBeenCalled();
  });

  it("refuses a token Siteverify rejects — no email is resent", async () => {
    siteverifyReplies({ success: false });
    const res = await resendPasswordSignUpCode({ ok: false }, withCaptcha({ email: "person@example.test" }));
    expect(res.code).toBe("authPasswordPreview.error.captchaRejected");
    expect(resend).not.toHaveBeenCalled();
  });

  it("preserves rate-limit surfacing", async () => {
    resend.mockResolvedValueOnce({ error: { status: 429 } });
    const res = await resendPasswordSignUpCode({ ok: false }, withCaptcha({ email: "person@example.test" }));
    expect(res.code).toBe("authPasswordPreview.error.rateLimited");
  });

  it("also enumeration-normalizes an already-confirmed account's resend failure into the same success response", async () => {
    resend.mockResolvedValueOnce({ error: { code: "user_already_exists" } });
    const res = await resendPasswordSignUpCode({ ok: false }, withCaptcha({ email: "already-has-account@example.test" }));
    expect(res.ok).toBe(true);
    expect(res.code).toBe("authPasswordPreview.info.codeSent");
  });
});

describe("verifyPasswordSignUp (Architecture B — OTP-only, no password)", () => {
  it("verifies with type:'signup' (the EmailOtpType the installed @supabase/auth-js defines for this exact case) — never 'email'", async () => {
    verifyOtp.mockResolvedValueOnce({ error: null, data: { user: { id: "u1", email: "person@example.test" } } });
    rpc.mockResolvedValue({ data: null, error: null }); // covers record_consent + pending_registration_consume
    await expect(
      verifyPasswordSignUp({ ok: false }, fd({ email: "person@example.test", token: "123456" })),
    ).rejects.toThrow("REDIRECT:/onboarding");
    expect(verifyOtp).toHaveBeenCalledWith({ email: "person@example.test", token: "123456", type: "signup" });
  });

  it("never calls updateUser — the password was already set by signUp() in step 1, not here", async () => {
    verifyOtp.mockResolvedValueOnce({ error: null, data: { user: { id: "u1", email: "person@example.test" } } });
    rpc.mockResolvedValue({ data: null, error: null }); // covers record_consent + pending_registration_consume
    await expect(
      verifyPasswordSignUp({ ok: false }, fd({ email: "person@example.test", token: "123456" })),
    ).rejects.toThrow("REDIRECT:/onboarding");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("still stamps the authoritative (app_metadata) flag on success — now purely for migrationEligibility() bookkeeping, not interruption-resume", async () => {
    verifyOtp.mockResolvedValueOnce({ error: null, data: { user: { id: "u1", email: "person@example.test" } } });
    rpc.mockResolvedValue({ data: null, error: null }); // covers record_consent + pending_registration_consume
    await expect(
      verifyPasswordSignUp({ ok: false }, fd({ email: "person@example.test", token: "123456" })),
    ).rejects.toThrow("REDIRECT:/onboarding");
    expect(markPasswordAttachedAuthoritatively).toHaveBeenCalledWith("u1");
  });

  it("a wrong/garbage code never creates a session and never stamps the flag", async () => {
    verifyOtp.mockResolvedValueOnce({ error: { message: "Token has expired or is invalid" }, data: { user: null } });
    const res = await verifyPasswordSignUp({ ok: false }, fd({ email: "person@example.test", token: "000000" }));
    expect(res.ok).toBe(false);
    expect(res.code).toBe("authPasswordPreview.error.verifyFailed");
    expect(markPasswordAttachedAuthoritatively).not.toHaveBeenCalled();
  });

  it("distinguishes an expired code", async () => {
    verifyOtp.mockResolvedValueOnce({ error: { code: "otp_expired" }, data: { user: null } });
    const res = await verifyPasswordSignUp({ ok: false }, fd({ email: "person@example.test", token: "000000" }));
    expect(res.code).toBe("authPasswordPreview.error.otpExpired");
  });

  it("rejects a malformed (non-6-digit) token before ever calling verifyOtp", async () => {
    const res = await verifyPasswordSignUp({ ok: false }, fd({ email: "person@example.test", token: "12" }));
    expect(res.code).toBe("authPasswordPreview.error.invalidCode");
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});

describe("resumePasswordSignUpEmail / finishPasswordSignUp — Architecture-A-only machinery, removed", () => {
  it("no longer exported — Architecture B's signUp() sets the password atomically, so there is no interrupted 'confirmed but no password' state left to resume", async () => {
    const actions = await import("./auth-password-preview");
    expect((actions as Record<string, unknown>).resumePasswordSignUpEmail).toBeUndefined();
    expect((actions as Record<string, unknown>).finishPasswordSignUp).toBeUndefined();
  });
});

describe("passwordSignIn", () => {
  it("valid password sign-in reaches the derived landing", async () => {
    signInWithPassword.mockResolvedValueOnce({ error: null });
    rpc.mockResolvedValueOnce({ data: "active_personal" });
    resolveActiveLanding.mockResolvedValueOnce("/b2b");
    await expect(
      passwordSignIn({ ok: false }, fd({ email: "a-owner@example.test", password: GOOD_PASSWORD, next: "/b2b" })),
    ).rejects.toThrow("REDIRECT:/b2b");
  });

  it("invalid credentials and an unknown account return the SAME generic message (anti-enumeration)", async () => {
    signInWithPassword.mockResolvedValueOnce({ error: { message: "Invalid login credentials" } });
    const wrong = await passwordSignIn({ ok: false }, fd({ email: "a-owner@example.test", password: "wrong-one-here-too" }));
    signInWithPassword.mockResolvedValueOnce({ error: { message: "Invalid login credentials" } });
    const unknown = await passwordSignIn({ ok: false }, fd({ email: "never-registered@example.test", password: GOOD_PASSWORD }));
    expect(wrong.code).toBe(unknown.code);
    expect(wrong.code).toBe("authPasswordPreview.error.invalidCredentials");
  });

  it("an interrupted-registration account (email confirmed, never got a password) fails generically at sign-in too", async () => {
    signInWithPassword.mockResolvedValueOnce({ error: { message: "Invalid login credentials" } });
    const res = await passwordSignIn({ ok: false }, fd({ email: "mid-registration@example.test", password: GOOD_PASSWORD }));
    expect(res.code).toBe("authPasswordPreview.error.invalidCredentials");
  });

  it("distinguishes a genuine rate limit", async () => {
    signInWithPassword.mockResolvedValueOnce({ error: { status: 429 } });
    const res = await passwordSignIn({ ok: false }, fd({ email: "a-owner@example.test", password: GOOD_PASSWORD }));
    expect(res.code).toBe("authPasswordPreview.error.rateLimited");
  });

  it("rejects an unsafe redirect target", async () => {
    signInWithPassword.mockResolvedValueOnce({ error: null });
    rpc.mockResolvedValueOnce({ data: "active_personal" });
    resolveActiveLanding.mockResolvedValueOnce("/b2b");
    await expect(
      passwordSignIn({ ok: false }, fd({ email: "a-owner@example.test", password: GOOD_PASSWORD, next: "https://evil.example" })),
    ).rejects.toThrow("REDIRECT:/b2b");
  });

  it("signs in with NO captcha token — no Turnstile, no Siteverify, nothing but email + password", async () => {
    signInWithPassword.mockResolvedValueOnce({ error: null });
    rpc.mockResolvedValueOnce({ data: "active_personal" });
    resolveActiveLanding.mockResolvedValueOnce("/b2b");
    await expect(
      passwordSignIn({ ok: false }, fd({ email: "a-owner@example.test", password: GOOD_PASSWORD })),
    ).rejects.toThrow("REDIRECT:/b2b");
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "a-owner@example.test", password: GOOD_PASSWORD });
    expect(siteverifyCalls()).toHaveLength(0);
  });

  it("ignores any captchaToken a client still submits — it is neither verified nor forwarded", async () => {
    signInWithPassword.mockResolvedValueOnce({ error: { message: "Invalid login credentials" } });
    const res = await passwordSignIn(
      { ok: false },
      fd({ email: "a-owner@example.test", password: GOOD_PASSWORD, captchaToken: "stray-token" }),
    );
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "a-owner@example.test", password: GOOD_PASSWORD });
    expect(siteverifyCalls()).toHaveLength(0);
    expect(res.code).toBe("authPasswordPreview.error.invalidCredentials");
  });
});

describe("Forgot Password — Screen 1: requestRecoveryCode (ISOLATED client — never getServerSupabase())", () => {
  it("redirects to Screen 2 for a known email", async () => {
    isolatedResetPasswordForEmail.mockResolvedValueOnce({ error: null });
    await expect(requestRecoveryCode({ ok: false }, withCaptcha({ email: "a-owner@example.test" }))).rejects.toThrow(
      "REDIRECT:/preview/auth-password/forgot-password/verify",
    );
    expect(cookieStore.get("pwr_email")).toBe("a-owner@example.test");
    expect(createIsolatedAuthClient).toHaveBeenCalled();
  });

  it("redirects IDENTICALLY for an unknown email — same cookie behavior, same destination (neutral response)", async () => {
    isolatedResetPasswordForEmail.mockResolvedValueOnce({ error: { message: "User not found" } });
    await expect(
      requestRecoveryCode({ ok: false }, withCaptcha({ email: "never-registered@example.test" })),
    ).rejects.toThrow("REDIRECT:/preview/auth-password/forgot-password/verify");
    expect(cookieStore.get("pwr_email")).toBe("never-registered@example.test");
  });

  it("only a rate limit is allowed to differ (and does not redirect)", async () => {
    isolatedResetPasswordForEmail.mockResolvedValueOnce({ error: { status: 429 } });
    const res = await requestRecoveryCode({ ok: false }, withCaptcha({ email: "a-owner@example.test" }));
    expect(res.ok).toBe(false);
    expect(res.code).toBe("authPasswordPreview.error.rateLimited");
    expect(cookieStore.has("pwr_email")).toBe(false);
  });

  it("sets redirectTo from the request's own origin, never a caller-supplied value", async () => {
    isolatedResetPasswordForEmail.mockResolvedValueOnce({ error: null });
    await expect(requestRecoveryCode({ ok: false }, withCaptcha({ email: "a-owner@example.test" }))).rejects.toThrow();
    expect(isolatedResetPasswordForEmail).toHaveBeenCalledWith("a-owner@example.test", {
      redirectTo: "http://127.0.0.1:3000/preview/auth-password/forgot-password/reset",
    });
  });

  it("refuses without a captcha token — never calls resetPasswordForEmail", async () => {
    const res = await requestRecoveryCode({ ok: false }, fd({ email: "a-owner@example.test" }));
    expect(res.code).toBe("authPasswordPreview.error.captchaRequired");
    expect(isolatedResetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("uses the SAME Siteverify gate: a rejected token never requests a recovery email", async () => {
    siteverifyReplies({ success: false, "error-codes": ["invalid-input-response"] });
    const res = await requestRecoveryCode({ ok: false }, withCaptcha({ email: "a-owner@example.test" }));
    expect(res.code).toBe("authPasswordPreview.error.captchaRejected");
    expect(isolatedResetPasswordForEmail).not.toHaveBeenCalled();
    expect(cookieStore.has("pwr_email")).toBe(false);
  });

  it("fails closed when Siteverify is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const res = await requestRecoveryCode({ ok: false }, withCaptcha({ email: "a-owner@example.test" }));
    expect(res.code).toBe("authPasswordPreview.error.captchaRejected");
    expect(isolatedResetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("verifies the token with Siteverify before calling Supabase", async () => {
    isolatedResetPasswordForEmail.mockResolvedValueOnce({ error: null });
    await expect(requestRecoveryCode({ ok: false }, withCaptcha({ email: "a-owner@example.test" }))).rejects.toThrow();
    expect(siteverifyCalls()).toHaveLength(1);
    expect(new URLSearchParams(String((siteverifyCalls()[0]![1] as RequestInit).body)).get("response")).toBe("test-captcha-token");
  });
});

describe("No dependency on Supabase's global CAPTCHA", () => {
  it("supabase/config.toml keeps [auth.captcha] disabled (no active section)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const config = fs.readFileSync(path.resolve(process.cwd(), "..", "supabase", "config.toml"), "utf8");
    expect(config).not.toMatch(/^\s*\[auth\.captcha\]/m);
  });
});

describe("Forgot Password — Screen 2: recoveryFlowEmail / verifyRecoveryCode / resend (ISOLATED client)", () => {
  it("recoveryFlowEmail is null with no prior Screen-1 request (direct navigation)", async () => {
    expect(await recoveryFlowEmail()).toBeNull();
  });

  it("verifyRecoveryCode refuses without recovery state (direct navigation to verify)", async () => {
    const res = await verifyRecoveryCode({ ok: false }, fd({ token: "123456" }));
    expect(res.code).toBe("authPasswordPreview.error.recoveryStateMissing");
    expect(isolatedVerifyOtp).not.toHaveBeenCalled();
  });

  it("verifyRecoveryCode succeeds, seals the recovery session's access AND refresh tokens into an encrypted grant cookie (never a normal session cookie), and lets the client navigate to Screen 3", async () => {
    cookieStore.set("pwr_email", "a-owner@example.test");
    isolatedVerifyOtp.mockResolvedValueOnce({
      error: null,
      data: { session: { access_token: "isolated-access-token", refresh_token: "isolated-refresh-token" } },
    });
    const res = await verifyRecoveryCode({ ok: false }, fd({ token: "123456" }));
    expect(res.ok).toBe(true);
    expect(isolatedVerifyOtp).toHaveBeenCalledWith({ email: "a-owner@example.test", token: "123456", type: "recovery" });
    expect(encryptRecoveryGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "a-owner@example.test",
        accessToken: "isolated-access-token",
        refreshToken: "isolated-refresh-token",
      }),
    );
    expect(cookieStore.has("pwr_grant")).toBe(true);
    // Never a normal, cookie-backed session — getServerSupabase()/verifyOtp is untouched.
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("distinguishes an expired recovery code", async () => {
    cookieStore.set("pwr_email", "a-owner@example.test");
    isolatedVerifyOtp.mockResolvedValueOnce({ error: { code: "otp_expired" }, data: { session: null } });
    const res = await verifyRecoveryCode({ ok: false }, fd({ token: "000000" }));
    expect(res.code).toBe("authPasswordPreview.error.otpExpired");
  });

  it("repeated invalid attempts surface GoTrue's own rate limit, not a client-invented one", async () => {
    cookieStore.set("pwr_email", "a-owner@example.test");
    isolatedVerifyOtp.mockResolvedValueOnce({ error: { code: "over_request_rate_limit" }, data: { session: null } });
    const res = await verifyRecoveryCode({ ok: false }, fd({ token: "000000" }));
    expect(res.code).toBe("authPasswordPreview.error.rateLimited");
  });

  it("resend re-sends to the cookie-sourced email without exposing it to the client", async () => {
    cookieStore.set("pwr_email", "a-owner@example.test");
    isolatedResetPasswordForEmail.mockResolvedValueOnce({ error: null });
    const res = await resendRecoveryCode({ ok: false }, fd({}));
    expect(res.ok).toBe(true);
    expect(isolatedResetPasswordForEmail).toHaveBeenCalledWith("a-owner@example.test", expect.any(Object));
  });

  it("resend refuses without recovery state", async () => {
    const res = await resendRecoveryCode({ ok: false }, fd({}));
    expect(res.code).toBe("authPasswordPreview.error.recoveryStateMissing");
  });
});

describe("Forgot Password — Screen 3: requireRecoverySession / resetPasswordAndSignOut (recovery-grant isolation)", () => {
  it("requireRecoverySession is null with no grant cookie at all (direct navigation, refresh after sign-out)", async () => {
    expect(await requireRecoverySession()).toBeNull();
    // No session lookup at all — decrypting the grant IS the authorization check.
    expect(getUser).not.toHaveBeenCalled();
  });

  it("requireRecoverySession is null for a normal signed-in session with no recovery grant — a normal login cannot browse Screen 3", async () => {
    getUser.mockResolvedValue({ data: { user: { email: "a-owner@example.test" } } });
    expect(await requireRecoverySession()).toBeNull();
  });

  it("requireRecoverySession returns the email once a valid recovery grant is present", async () => {
    seedRecoveryGrant("a-owner@example.test");
    expect(await requireRecoverySession()).toEqual({ email: "a-owner@example.test" });
  });

  it("requireRecoverySession is null once the grant has expired — expiry is enforced independent of the cookie's own maxAge", async () => {
    cookieStore.set(
      "pwr_grant",
      JSON.stringify({ email: "a-owner@example.test", accessToken: "t", refreshToken: "r", exp: Date.now() - 1000 }),
    );
    expect(await requireRecoverySession()).toBeNull();
  });

  it("resetPasswordAndSignOut refuses without a recovery grant, even with a normal valid signed-in session — a normal login cannot reset via this endpoint", async () => {
    getUser.mockResolvedValue({ data: { user: { email: "a-owner@example.test" } } });
    const res = await resetPasswordAndSignOut({ ok: false }, fd({ password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD }));
    expect(res.code).toBe("authPasswordPreview.error.recoveryStateMissing");
    expect(isolatedUpdateUser).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("resetPasswordAndSignOut refuses if the sealed session fails to hydrate (setSession errors) — never falls through to updateUser", async () => {
    seedRecoveryGrant("a-owner@example.test");
    isolatedSetSession.mockResolvedValueOnce({ error: { message: "invalid refresh token" }, data: { user: null, session: null } });
    const res = await resetPasswordAndSignOut({ ok: false }, fd({ password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD }));
    expect(res.code).toBe("authPasswordPreview.error.recoveryStateMissing");
    expect(isolatedUpdateUser).not.toHaveBeenCalled();
  });

  it("on success: hydrates a FRESH isolated client with the grant's access+refresh tokens via setSession (never the cookie-backed client), stamps the authoritative flag, signs out globally, clears the grant, sets the one-time success cookie, and redirects to Screen 4", async () => {
    seedRecoveryGrant("a-owner@example.test", "isolated-access-token", "isolated-refresh-token");
    isolatedSetSession.mockResolvedValueOnce({ error: null, data: { user: { id: "u1" }, session: {} } });
    isolatedUpdateUser.mockResolvedValueOnce({ error: null, data: { user: { id: "u1" } } });
    await expect(
      resetPasswordAndSignOut({ ok: false }, fd({ password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD })),
    ).rejects.toThrow("REDIRECT:/preview/auth-password/forgot-password/success");

    expect(isolatedSetSession).toHaveBeenCalledWith({
      access_token: "isolated-access-token",
      refresh_token: "isolated-refresh-token",
    });
    expect(isolatedUpdateUser).toHaveBeenCalledWith({ password: GOOD_PASSWORD });
    expect(markPasswordAttachedAuthoritatively).toHaveBeenCalledWith("u1");
    expect(isolatedSignOut).toHaveBeenCalledWith({ scope: "global" });
    // The normal, cookie-backed client is never touched by the recovery flow.
    expect(updateUser).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();

    expect(cookieStore.has("pwr_email")).toBe(false);
    expect(cookieStore.has("pwr_grant")).toBe(false);
    expect(cookieStore.get("pwr_success")).toBe("1");
  });

  it("rejects a weak new password even with a genuine recovery grant, and never calls setSession/updateUser", async () => {
    seedRecoveryGrant("a-owner@example.test");
    const res = await resetPasswordAndSignOut({ ok: false }, fd({ password: "abcdefghijzz", confirmPassword: "abcdefghijzz" }));
    expect(res.code).toBe("authPasswordPreview.error.passwordSequential");
    expect(isolatedSetSession).not.toHaveBeenCalled();
    expect(isolatedUpdateUser).not.toHaveBeenCalled();
    expect(isolatedSignOut).not.toHaveBeenCalled();
  });

  it("a recovery grant is single-purpose: after resetPasswordAndSignOut deletes the cookie, a second attempt (grant already gone) refuses", async () => {
    seedRecoveryGrant("a-owner@example.test");
    isolatedSetSession.mockResolvedValueOnce({ error: null, data: { user: { id: "u1" }, session: {} } });
    isolatedUpdateUser.mockResolvedValueOnce({ error: null, data: { user: { id: "u1" } } });
    await expect(
      resetPasswordAndSignOut({ ok: false }, fd({ password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD })),
    ).rejects.toThrow("REDIRECT:");
    expect(cookieStore.has("pwr_grant")).toBe(false);

    const second = await resetPasswordAndSignOut({ ok: false }, fd({ password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD }));
    expect(second.code).toBe("authPasswordPreview.error.recoveryStateMissing");
    expect(isolatedUpdateUser).toHaveBeenCalledTimes(1);
  });
});

describe("Forgot Password — Screen 4: consumeRecoverySuccess", () => {
  it("is false by default (direct navigation without a completed reset)", async () => {
    expect(await consumeRecoverySuccess()).toBe(false);
  });

  it("is true right after a real reset (read-only — cookies cannot be deleted from a Server Component; the short maxAge set in resetPasswordAndSignOut is what bounds the window, not deletion here)", async () => {
    cookieStore.set("pwr_success", "1");
    expect(await consumeRecoverySuccess()).toBe(true);
    expect(await consumeRecoverySuccess()).toBe(true);
  });
});

describe("Existing-passwordless-user migration", () => {
  it("migrationEligibility reflects an account with no password yet (app_metadata, not user_metadata)", async () => {
    getUser.mockResolvedValueOnce({ data: { user: { email: "legacy@example.test", app_metadata: {} } } });
    expect(await migrationEligibility()).toEqual({ email: "legacy@example.test", hasPassword: false });
  });

  it("migrationEligibility reflects an account that already migrated", async () => {
    getUser.mockResolvedValueOnce({
      data: { user: { email: "legacy@example.test", app_metadata: { [PASSWORD_SET_FLAG]: true } } },
    });
    expect(await migrationEligibility()).toEqual({ email: "legacy@example.test", hasPassword: true });
  });

  it("migrationEligibility is NOT fooled by a user forging the flag into their own user_metadata", async () => {
    getUser.mockResolvedValueOnce({
      data: {
        user: {
          email: "legacy@example.test",
          app_metadata: {},
          user_metadata: { [PASSWORD_SET_FLAG]: true },
        },
      },
    });
    expect(await migrationEligibility()).toEqual({ email: "legacy@example.test", hasPassword: false });
  });

  it("requestMigrationCode uses Supabase's reauthenticate() nonce flow, not a fresh sign-in", async () => {
    getUser.mockResolvedValueOnce({ data: { user: { email: "legacy@example.test" } } });
    reauthenticate.mockResolvedValueOnce({ error: null });
    const res = await requestMigrationCode({ ok: false }, fd({}));
    expect(res.ok).toBe(true);
    expect(reauthenticate).toHaveBeenCalled();
  });

  it("requestMigrationCode requires a session", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await requestMigrationCode({ ok: false }, fd({}));
    expect(res.code).toBe("authPasswordPreview.error.sessionExpired");
  });

  it("completeMigration passes the nonce through to updateUser and stamps the AUTHORITATIVE flag via the admin path", async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: "u1", email: "legacy@example.test" } } });
    updateUser.mockResolvedValueOnce({ error: null });
    const res = await completeMigration(
      { ok: false },
      fd({ token: "123456", password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD }),
    );
    expect(res.ok).toBe(true);
    expect(updateUser).toHaveBeenCalledWith({ password: GOOD_PASSWORD, nonce: "123456" });
    expect(markPasswordAttachedAuthoritatively).toHaveBeenCalledWith("u1");
  });

  it("completeMigration rejects a weak password", async () => {
    getUser.mockResolvedValueOnce({ data: { user: { email: "legacy@example.test" } } });
    const res = await completeMigration({ ok: false }, fd({ token: "123456", password: "abcdefghijzz", confirmPassword: "abcdefghijzz" }));
    expect(res.code).toBe("authPasswordPreview.error.passwordSequential");
    expect(updateUser).not.toHaveBeenCalled();
    expect(markPasswordAttachedAuthoritatively).not.toHaveBeenCalled();
  });
});

describe("Authenticated changePassword", () => {
  it("requires the current password to be supplied", async () => {
    getUser.mockResolvedValueOnce({ data: { user: { email: "a-owner@example.test" } } });
    const res = await changePassword({ ok: false }, fd({ newPassword: GOOD_PASSWORD, confirmNewPassword: GOOD_PASSWORD }));
    expect(res.code).toBe("authPasswordPreview.error.currentPasswordRequired");
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("re-verifies the CURRENT password via signInWithPassword — an existing session alone is not enough", async () => {
    getUser.mockResolvedValueOnce({ data: { user: { email: "a-owner@example.test" } } });
    signInWithPassword.mockResolvedValueOnce({ error: { message: "Invalid login credentials" } });
    const res = await changePassword(
      { ok: false },
      fd({ currentPassword: "wrong-current-password", newPassword: GOOD_PASSWORD, confirmNewPassword: GOOD_PASSWORD }),
    );
    expect(res.code).toBe("authPasswordPreview.error.currentPasswordWrong");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("rejects a new password identical to the current one", async () => {
    getUser.mockResolvedValueOnce({ data: { user: { email: "a-owner@example.test" } } });
    signInWithPassword.mockResolvedValueOnce({ error: null });
    const res = await changePassword(
      { ok: false },
      fd({ currentPassword: GOOD_PASSWORD, newPassword: GOOD_PASSWORD, confirmNewPassword: GOOD_PASSWORD }),
    );
    expect(res.code).toBe("authPasswordPreview.error.samePassword");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("on success: updates the password and signs out every OTHER session, keeping this one (already-set account — no authoritative-flag write needed)", async () => {
    getUser.mockResolvedValueOnce({ data: { user: { email: "a-owner@example.test" } } });
    signInWithPassword.mockResolvedValueOnce({ error: null });
    updateUser.mockResolvedValueOnce({ error: null });
    const newPw = "a-completely-different-passphrase";
    const res = await changePassword(
      { ok: false },
      fd({ currentPassword: GOOD_PASSWORD, newPassword: newPw, confirmNewPassword: newPw }),
    );
    expect(res.ok).toBe(true);
    expect(signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(markPasswordAttachedAuthoritatively).not.toHaveBeenCalled();
  });
});
