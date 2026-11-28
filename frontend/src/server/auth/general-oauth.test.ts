import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const entryLandingPath = vi.fn();
vi.mock("@/server/auth/phone-password", () => ({ entryLandingPath: (...a: unknown[]) => entryLandingPath(...a) }));

import { completeGeneralOAuth, generalCallbackUrl } from "./general-oauth";

const exchangeCodeForSession = vi.fn();
const signOut = vi.fn();
const rpc = vi.fn();
const supabase = { auth: { exchangeCodeForSession, signOut }, rpc } as never;
const run = (over: Partial<{ code: string | null; next: string | null; providerError: string | null }> = {}) =>
  completeGeneralOAuth(supabase, { code: "c", next: null, providerError: null, ...over });

/** my_registration_state answers in order; other RPCs succeed. */
function states(...seq: string[]) {
  const queue = [...seq];
  rpc.mockImplementation(async (name: string) => (name === "my_registration_state" ? { data: queue.shift() ?? seq.at(-1) } : { error: null }));
}

beforeEach(() => {
  vi.clearAllMocks();
  exchangeCodeForSession.mockResolvedValue({ data: { user: { user_metadata: { full_name: "Nadia Salem" } } }, error: null });
  signOut.mockResolvedValue({ error: null });
  entryLandingPath.mockResolvedValue("/home");
});

describe("generalCallbackUrl", () => {
  it("marks the general flow and carries only a sanitized next", () => {
    const url = new URL(generalCallbackUrl("http://localhost:3350", "/home/settings"));
    expect(url.pathname).toBe("/auth/callback");
    expect(url.searchParams.get("general")).toBe("1");
    expect(url.searchParams.get("next")).toBe("/home/settings");
    // A hostile `next` collapses to the default, which is simply left off.
    expect(new URL(generalCallbackUrl("http://localhost:3350", "https://evil.test/x")).searchParams.has("next")).toBe(false);
  });
});

describe("completeGeneralOAuth", () => {
  it("returns to sign-in when the provider reports an error or sends no code", async () => {
    expect(await run({ providerError: "access_denied" })).toEqual({ path: "/auth/sign-in?error=oauth" });
    expect(await run({ code: null })).toEqual({ path: "/auth/sign-in?error=oauth" });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("returns to sign-in when the code exchange fails", async () => {
    exchangeCodeForSession.mockResolvedValueOnce({ data: { user: null }, error: { code: "bad" } });
    expect(await run()).toEqual({ path: "/auth/sign-in?error=oauth" });
  });

  it("signs a registered person in and lands them in the app", async () => {
    states("active_personal");
    expect(await run({ next: "/home/settings" })).toEqual({ path: "/home" });
    expect(entryLandingPath).toHaveBeenCalledWith(supabase, "/home/settings");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("sends a first-time person into the registration steps, after consent and the provider's name", async () => {
    states("consent_pending", "account_type_pending");
    expect(await run()).toEqual({ path: "/auth/finish-registration" });
    expect(rpc).toHaveBeenCalledWith("record_consent", expect.objectContaining({ p_types: ["terms", "privacy", "pilot"] }));
    expect(rpc).toHaveBeenCalledWith("profile_set_display_name", { p_display_name: "Nadia Salem" });
    expect(rpc).not.toHaveBeenCalledWith("onboarding_select_account_type", expect.anything());
  });

  it("refuses a provider account with no confirmed email and signs the session out", async () => {
    states("unverified");
    expect(await run()).toEqual({ path: "/auth/sign-in?error=oauth_email" });
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("sends a blocked account to the suspended page", async () => {
    states("manually_blocked");
    expect(await run()).toEqual({ path: "/auth/suspended" });
  });
});
