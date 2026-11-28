import { beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  perform: vi.fn(),
  resolve: vi.fn(),
  deps: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: s.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ marker: "user-client" }) }));
vi.mock("@/server/auth/security-session", () => ({ resolveSecuritySession: s.resolve }));
vi.mock("@/server/auth/installer-security", async () => {
  const actual = await vi.importActual<typeof import("@/server/auth/installer-security")>("@/server/auth/installer-security");
  return { SECURITY_CODES: actual.SECURITY_CODES, defaultSecurityDeps: s.deps, performPhoneChange: s.perform };
});

import { changeLoginPhoneAction } from "./profile-identity";
import { SECURITY_CODES } from "@/server/auth/installer-security";

const OLD_ALIAS = "p201055500101@craftsman-login.aladdin.invalid";
const form = (over: Record<string, string> = {}) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ countryIso2: "EG", national: "1055500202", e164: "+201055500202", currentPassword: "test-password-not-real", ...over })) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  s.resolve.mockResolvedValue({ actor: { userId: "u1", loginEmail: OLD_ALIAS, displayName: "Hassan" }, session: { marker: "session" } });
  s.deps.mockReturnValue({ marker: "deps" });
  s.perform.mockResolvedValue({ ok: true, code: SECURITY_CODES.phoneDone });
});

describe("changeLoginPhoneAction (phone + password accounts) - the journaled re-key", () => {
  it("delegates to the journaled phone change with the session actor and the user client, then refreshes the header", async () => {
    expect(await changeLoginPhoneAction({ ok: false }, form())).toEqual({ ok: true });
    expect(s.deps).toHaveBeenCalledWith({ marker: "user-client" });          // the confirmation runs through the caller's session
    expect(s.perform).toHaveBeenCalledWith({ marker: "deps" }, expect.objectContaining({ userId: "u1" }), { marker: "session" },
      expect.objectContaining({ countryIso2: "EG", national: "1055500202", password: "test-password-not-real" }));
    expect(s.revalidate).toHaveBeenCalledWith("/home", "layout");
  });

  it("never passes a client-supplied E.164 (the number is recomputed from country + national)", async () => {
    await changeLoginPhoneAction({ ok: false }, form({ e164: "+201099999999" }));
    expect(s.perform.mock.calls[0]?.[3]).not.toHaveProperty("e164");
  });

  it("asks for the password before anything else", async () => {
    expect(await changeLoginPhoneAction({ ok: false }, form({ currentPassword: "" }))).toEqual({ ok: false, code: "profileIdentity.phone.passwordRequired" });
    expect(s.perform).not.toHaveBeenCalled();
  });

  it.each([
    [SECURITY_CODES.wrongPassword, "profileIdentity.phone.wrongPassword"],
    [SECURITY_CODES.locked, "profileIdentity.phone.rateLimited"],
    [SECURITY_CODES.phoneUnavailable, "profileIdentity.phone.unavailable"],
    [SECURITY_CODES.phoneInProgress, "profileIdentity.phone.inProgress"],
    [SECURITY_CODES.needsAttention, "profileIdentity.phone.needsAttention"],
    [SECURITY_CODES.phoneFailed, "profileIdentity.phone.error"],
    [SECURITY_CODES.unavailable, "profileIdentity.phone.error"],
  ])("maps %s to %s and does not revalidate", async (code, mapped) => {
    s.perform.mockResolvedValue({ ok: false, code });
    expect(await changeLoginPhoneAction({ ok: false }, form())).toEqual({ ok: false, code: mapped });
    expect(s.revalidate).not.toHaveBeenCalled();
  });

  it("treats the same number as a no-op success", async () => {
    s.perform.mockResolvedValue({ ok: false, code: SECURITY_CODES.phoneSame });
    expect(await changeLoginPhoneAction({ ok: false }, form())).toEqual({ ok: true });
  });

  it("is not available to an account that signs in with e-mail", async () => {
    s.resolve.mockResolvedValue({ actor: { userId: "u2", loginEmail: "karim@example.test", displayName: null }, session: {} });
    expect(await changeLoginPhoneAction({ ok: false }, form())).toEqual({ ok: false, code: "profileIdentity.phone.error" });
    expect(s.perform).not.toHaveBeenCalled();
  });

  it("an unexpected failure is a generic error, never a thrown request", async () => {
    s.perform.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await changeLoginPhoneAction({ ok: false }, form())).toEqual({ ok: false, code: "profileIdentity.phone.error" });
  });
});
