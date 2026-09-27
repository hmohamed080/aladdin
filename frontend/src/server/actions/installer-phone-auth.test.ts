import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: () => null })),
}));

const signInWithPassword = vi.fn();
const signOut = vi.fn();
const rpc = vi.fn();
const supabase = { auth: { signInWithPassword, signOut }, rpc };
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(async () => supabase) }));

const { resolveActiveLanding, verifyTurnstileToken, isCanonicalPhoneTaken, createCraftsmanPasswordUser, deleteCraftsmanPasswordUser } =
  vi.hoisted(() => ({
    resolveActiveLanding: vi.fn(),
    verifyTurnstileToken: vi.fn(),
    isCanonicalPhoneTaken: vi.fn(),
    createCraftsmanPasswordUser: vi.fn(),
    deleteCraftsmanPasswordUser: vi.fn(),
  }));
vi.mock("@/server/queries/landing", () => ({ resolveActiveLanding }));
vi.mock("@/server/auth/turnstile", () => ({ verifyTurnstileToken, clientIpFrom: () => null }));
vi.mock("@/lib/supabase/admin-server", () => ({ isCanonicalPhoneTaken, createCraftsmanPasswordUser, deleteCraftsmanPasswordUser }));

import { craftsmanSignIn, craftsmanSignUp } from "./installer-phone-auth";

const ALIAS = "p201093817264@craftsman-login.aladdin.invalid";
const PASSWORD = "green-tiles-on-roof";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

const validSignUp = () =>
  form({ name: " أحمد  محمد ", phone: "01093817264", password: PASSWORD, consent: "on", captchaToken: "tok" });

/** Default RPC behavior: every write succeeds, the account ends access_ready. */
function rpcOk(overrides: Record<string, unknown> = {}) {
  rpc.mockImplementation(async (name: string) => {
    if (name in overrides) return overrides[name];
    if (name === "my_registration_state") return { data: "access_ready", error: null };
    return { data: null, error: null };
  });
}

async function run<T>(fn: () => Promise<T>): Promise<T | string> {
  try {
    return await fn();
  } catch (error) {
    return (error as Error).message;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyTurnstileToken.mockResolvedValue({ ok: true });
  isCanonicalPhoneTaken.mockResolvedValue(false);
  createCraftsmanPasswordUser.mockResolvedValue({ ok: true, userId: "user-1" });
  deleteCraftsmanPasswordUser.mockResolvedValue(true);
  signInWithPassword.mockResolvedValue({ data: {}, error: null });
  signOut.mockResolvedValue({ error: null });
  resolveActiveLanding.mockResolvedValue("/home");
  rpcOk();
});

describe("craftsmanSignUp", () => {
  it("creates a normal installer/technician account and lands on /home", async () => {
    const result = await run(() => craftsmanSignUp({ ok: false }, validSignUp()));
    expect(result).toBe("REDIRECT:/home");

    // Auth user: internal alias + the password once + the cleaned name. Never the raw phone.
    expect(createCraftsmanPasswordUser).toHaveBeenCalledWith({ loginAlias: ALIAS, password: PASSWORD, fullName: "أحمد محمد" });
    // The normal cookie session.
    expect(signInWithPassword).toHaveBeenCalledWith({ email: ALIAS, password: PASSWORD });

    const calls = rpc.mock.calls.map(([name, args]) => [name, args]);
    expect(calls).toContainEqual(["record_consent", { p_types: ["terms", "privacy", "pilot"], p_locale: "ar" }]);
    expect(calls).toContainEqual([
      "onboarding_select_account_type",
      { p_track: "professional", p_account_type: "installer_technician" },
    ]);
    expect(calls).toContainEqual([
      "profile_set_phone",
      { p_country_iso2: "EG", p_national: "1093817264", p_e164: "+201093817264" },
    ]);
    const username = calls.find(([name]) => name === "profile_set_username")?.[1] as { p_username: string };
    expect(username.p_username).toMatch(/^craftsman\.[a-z0-9]{8}$/);
    expect(deleteCraftsmanPasswordUser).not.toHaveBeenCalled();
  });

  it("retries the generated username on a collision", async () => {
    let attempts = 0;
    rpc.mockImplementation(async (name: string) => {
      if (name === "profile_set_username") {
        attempts += 1;
        return attempts < 3 ? { error: { code: "23505" } } : { error: null };
      }
      if (name === "my_registration_state") return { data: "access_ready", error: null };
      return { error: null };
    });
    expect(await run(() => craftsmanSignUp({ ok: false }, validSignUp()))).toBe("REDIRECT:/home");
    expect(attempts).toBe(3);
  });

  it.each([
    [{ name: "" }, "name", "temporaryCraftsman.error.nameRequired"],
    [{ phone: "0100" }, "phone", "temporaryCraftsman.error.phoneInvalid"],
    [{ password: "short" }, "password", "temporaryCraftsman.error.passwordTooShort"],
    [{ password: "password123" }, "password", "temporaryCraftsman.error.passwordCommon"],
    [{ consent: "" }, "consent", "temporaryCraftsman.error.consentRequired"],
  ])("rejects %o before creating anything", async (patch, field, code) => {
    const data = validSignUp();
    for (const [k, v] of Object.entries(patch)) data.set(k, v);
    const result = await craftsmanSignUp({ ok: false }, data);
    expect(result).toMatchObject({ ok: false, field, code });
    expect(result.values).not.toHaveProperty("password");
    expect(createCraftsmanPasswordUser).not.toHaveBeenCalled();
  });

  it("requires a verified Turnstile token", async () => {
    verifyTurnstileToken.mockResolvedValue({ ok: false, reason: "missing" });
    expect(await craftsmanSignUp({ ok: false }, validSignUp())).toMatchObject({
      field: "captcha",
      code: "temporaryCraftsman.error.captchaRequired",
    });
    expect(createCraftsmanPasswordUser).not.toHaveBeenCalled();
  });

  it("reports a phone already held by ANY account", async () => {
    isCanonicalPhoneTaken.mockResolvedValue(true);
    expect(await craftsmanSignUp({ ok: false }, validSignUp())).toMatchObject({
      field: "phone",
      code: "temporaryCraftsman.error.phoneExists",
    });
    expect(isCanonicalPhoneTaken).toHaveBeenCalledWith("+201093817264");
    expect(createCraftsmanPasswordUser).not.toHaveBeenCalled();
  });

  it("reports a phone whose alias already exists", async () => {
    createCraftsmanPasswordUser.mockResolvedValue({ ok: false, reason: "exists" });
    expect(await craftsmanSignUp({ ok: false }, validSignUp())).toMatchObject({ code: "temporaryCraftsman.error.phoneExists" });
  });

  it("rolls back (signs out + deletes the user) when initialization fails", async () => {
    rpcOk({ onboarding_select_account_type: { error: { code: "42501" } } });
    expect(await craftsmanSignUp({ ok: false }, validSignUp())).toMatchObject({
      field: "form",
      code: "temporaryCraftsman.error.signUpFailed",
    });
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(deleteCraftsmanPasswordUser).toHaveBeenCalledWith("user-1");
  });

  it("rolls back and reports the duplicate when the phone is taken in the race window", async () => {
    rpcOk({ profile_set_phone: { error: { code: "23505" } } });
    expect(await craftsmanSignUp({ ok: false }, validSignUp())).toMatchObject({ code: "temporaryCraftsman.error.phoneExists" });
    expect(deleteCraftsmanPasswordUser).toHaveBeenCalledWith("user-1");
  });

  it("rolls back when the account is not access_ready at the end", async () => {
    rpcOk({ my_registration_state: { data: "username_pending", error: null } });
    expect(await craftsmanSignUp({ ok: false }, validSignUp())).toMatchObject({ code: "temporaryCraftsman.error.signUpFailed" });
    expect(deleteCraftsmanPasswordUser).toHaveBeenCalledWith("user-1");
  });

  it("rolls back when the session cannot be established", async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: { code: "unexpected_failure" } });
    expect(await craftsmanSignUp({ ok: false }, validSignUp())).toMatchObject({ code: "temporaryCraftsman.error.signUpFailed" });
    expect(deleteCraftsmanPasswordUser).toHaveBeenCalledWith("user-1");
  });

  it("never logs the phone, alias, or password", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcOk({ record_consent: { error: { code: "XX000" } } });
    await craftsmanSignUp({ ok: false }, validSignUp());
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("1093817264");
    expect(logged).not.toContain("craftsman-login");
    expect(logged).not.toContain(PASSWORD);
    spy.mockRestore();
  });
});

describe("craftsmanSignIn", () => {
  it("signs in with the phone's alias and lands on the derived landing", async () => {
    const result = await run(() => craftsmanSignIn({ ok: false }, form({ phone: "+20 109 381 7264", password: PASSWORD })));
    expect(result).toBe("REDIRECT:/home");
    expect(signInWithPassword).toHaveBeenCalledWith({ email: ALIAS, password: PASSWORD });
  });

  it("returns ONE generic message for any credential failure", async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: { code: "invalid_credentials", status: 400 } });
    const result = await craftsmanSignIn({ ok: false }, form({ phone: "01093817264", password: "wrong-password" }));
    expect(result).toEqual({
      ok: false,
      code: "temporaryCraftsman.error.invalidCredentials",
      field: "form",
      values: { phone: "01093817264" },
    });
  });

  it("maps a rate limit separately", async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: { code: "over_request_rate_limit", status: 429 } });
    expect(await craftsmanSignIn({ ok: false }, form({ phone: "01093817264", password: "x" }))).toMatchObject({
      code: "temporaryCraftsman.error.rateLimited",
    });
  });

  it("validates the phone before calling Auth", async () => {
    expect(await craftsmanSignIn({ ok: false }, form({ phone: "12", password: "x" }))).toMatchObject({
      field: "phone",
      code: "temporaryCraftsman.error.phoneInvalid",
    });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it.each([
    ["/home/points", "/home/points"],
    ["/home", "/home"],
    ["/b2b/customers", "/home"],
    ["//evil.example/home", "/home"],
    ["https://evil.example/home", "/home"],
    ["/\\evil.example", "/home"],
    ["/admin", "/home"],
    [undefined, "/home"],
  ])("keeps a validated next=%s only inside the caller's own surface → %s", async (next, destination) => {
    const data = form({ phone: "01093817264", password: PASSWORD });
    if (next !== undefined) data.set("next", next);
    expect(await run(() => craftsmanSignIn({ ok: false }, data))).toBe(`REDIRECT:${destination}`);
  });

  it("hands onboarding and invitation continuations straight through, like the email sign-in", async () => {
    for (const next of ["/onboarding/username", "/auth/invite/abc123"]) {
      const data = form({ phone: "01093817264", password: PASSWORD, next });
      expect(await run(() => craftsmanSignIn({ ok: false }, data))).toBe(`REDIRECT:${next}`);
    }
  });

  it("resumes /onboarding for an account that is not access_ready", async () => {
    rpcOk({ my_registration_state: { data: "account_type_pending", error: null } });
    expect(await run(() => craftsmanSignIn({ ok: false }, form({ phone: "01093817264", password: PASSWORD })))).toBe(
      "REDIRECT:/onboarding",
    );
  });
});
