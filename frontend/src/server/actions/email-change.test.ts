import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const signInWithPassword = vi.fn();
const updateUser = vi.fn();
const verifyOtp = vi.fn();
const signOut = vi.fn();
const getUserIdentities = vi.fn();
const unlinkIdentity = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: async () => ({
    auth: { getUser, signInWithPassword, updateUser, verifyOtp, signOut, getUserIdentities, unlinkIdentity },
  }),
}));

import { confirmEmailChangeAction, startEmailChangeAction } from "./email-change";
import { unlinkProviderAction } from "./sign-in-methods";

const fd = (values: Record<string, string>) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
};
const START = { step: "start" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { email: "b-owner@example.test" } } });
  signInWithPassword.mockResolvedValue({ error: null });
  updateUser.mockResolvedValue({ error: null });
  verifyOtp.mockResolvedValue({ error: null });
  signOut.mockResolvedValue({ error: null });
});

describe("startEmailChangeAction", () => {
  it("re-checks the password and only then asks Auth to mail a code to the new address", async () => {
    const res = await startEmailChangeAction(START, fd({ newEmail: "New@Example.test", password: "pw" }));
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "b-owner@example.test", password: "pw" });
    expect(updateUser).toHaveBeenCalledWith({ email: "new@example.test" });
    expect(res).toEqual({ step: "code", email: "new@example.test" });
  });

  it("never changes anything when the password is wrong", async () => {
    signInWithPassword.mockResolvedValueOnce({ error: { status: 400 } });
    const res = await startEmailChangeAction(START, fd({ newEmail: "new@example.test", password: "nope" }));
    expect(res).toMatchObject({ step: "start", code: "password" });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("refuses the current address, a missing password and a malformed email without touching Auth", async () => {
    expect(await startEmailChangeAction(START, fd({ newEmail: "b-owner@example.test", password: "pw" }))).toMatchObject({ code: "same" });
    expect(await startEmailChangeAction(START, fd({ newEmail: "new@example.test", password: "" }))).toMatchObject({ code: "invalid" });
    expect(await startEmailChangeAction(START, fd({ newEmail: "nope", password: "pw" }))).toMatchObject({ code: "invalid" });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("does not offer an email change to a phone-registered account", async () => {
    getUser.mockResolvedValueOnce({ data: { user: { email: "p201012345678@craftsman-login.aladdin.invalid" } } });
    const res = await startEmailChangeAction(START, fd({ newEmail: "new@example.test", password: "pw" }));
    expect(res).toMatchObject({ code: "phone_account" });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("answers an address another account holds with a generic 'unavailable'", async () => {
    updateUser.mockResolvedValueOnce({ error: { status: 422 } });
    expect(await startEmailChangeAction(START, fd({ newEmail: "taken@example.test", password: "pw" }))).toMatchObject({ code: "unavailable" });
  });
});

describe("confirmEmailChangeAction", () => {
  const BOTH = { email: "new@example.test", currentToken: "111111", token: "222222" };
  const changed = () =>
    getUser
      .mockResolvedValueOnce({ data: { user: { email: "b-owner@example.test" } } })
      .mockResolvedValueOnce({ data: { user: { email: "new@example.test" } } });

  it("verifies the code of both addresses, then signs out every other session", async () => {
    changed();
    const res = await confirmEmailChangeAction(START, fd(BOTH));
    expect(verifyOtp.mock.calls).toEqual([
      [{ email: "b-owner@example.test", token: "111111", type: "email_change" }],
      [{ email: "new@example.test", token: "222222", type: "email_change" }],
    ]);
    expect(signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(res).toEqual({ step: "done", email: "new@example.test" });
  });

  it("never reaches the new address when the current address's code is wrong", async () => {
    verifyOtp.mockResolvedValueOnce({ error: { status: 403 } });
    const res = await confirmEmailChangeAction(START, fd(BOTH));
    expect(res).toMatchObject({ step: "code", code: "token", confirmed: { current: false, next: false } });
    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("remembers an accepted code, so a retry sends only the other one", async () => {
    verifyOtp.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { status: 403 } });
    const first = await confirmEmailChangeAction(START, fd(BOTH));
    expect(first).toMatchObject({ step: "code", code: "token", confirmed: { current: true, next: false } });
    expect(signOut).not.toHaveBeenCalled();

    verifyOtp.mockClear();
    changed();
    const res = await confirmEmailChangeAction(first, fd({ email: "new@example.test", token: "333333" }));
    expect(verifyOtp.mock.calls).toEqual([[{ email: "new@example.test", token: "333333", type: "email_change" }]]);
    expect(res).toEqual({ step: "done", email: "new@example.test" });
  });

  it("does not carry an accepted code over to a different new address", async () => {
    const prev = { step: "code", email: "other@example.test", confirmed: { current: true, next: false } } as const;
    expect(await confirmEmailChangeAction(prev, fd({ email: "new@example.test", token: "222222" }))).toMatchObject({ code: "token" });
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("does not report success while Auth still holds the old email", async () => {
    const res = await confirmEmailChangeAction(START, fd(BOTH));
    expect(res).toMatchObject({ step: "start", code: "error" });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("rejects a missing or short code before calling Auth", async () => {
    expect(await confirmEmailChangeAction(START, fd({ ...BOTH, token: "12" }))).toMatchObject({ code: "token" });
    expect(await confirmEmailChangeAction(START, fd({ email: "new@example.test", token: "222222" }))).toMatchObject({ code: "token" });
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});

describe("unlinkProviderAction", () => {
  const identity = (provider: string) => ({ provider, identity_id: provider });

  it("disconnects a provider when another sign-in method remains", async () => {
    getUserIdentities.mockResolvedValueOnce({ data: { identities: [identity("email"), identity("google")] }, error: null });
    unlinkIdentity.mockResolvedValueOnce({ error: null });
    expect(await unlinkProviderAction({ ok: false }, fd({ provider: "google" }))).toEqual({ ok: true });
    expect(unlinkIdentity).toHaveBeenCalledWith(identity("google"));
  });

  it("never removes the only way to sign in", async () => {
    getUserIdentities.mockResolvedValueOnce({ data: { identities: [identity("google")] }, error: null });
    expect(await unlinkProviderAction({ ok: false }, fd({ provider: "google" }))).toEqual({ ok: false, code: "last" });
    expect(unlinkIdentity).not.toHaveBeenCalled();
  });

  it("ignores an unknown provider name", async () => {
    expect(await unlinkProviderAction({ ok: false }, fd({ provider: "email" }))).toEqual({ ok: false, code: "error" });
    expect(getUserIdentities).not.toHaveBeenCalled();
  });
});
