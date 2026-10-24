import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn((url: string) => { throw Error("REDIRECT:" + url); }) }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => ({ get: () => null })) }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn() }));
vi.mock("@/lib/supabase/admin-server", () => ({}));
const mocks = vi.hoisted(() => ({ exchange: vi.fn(), signOut: vi.fn(), rpc: vi.fn(), landing: vi.fn() }));
vi.mock("@/server/queries/landing", () => ({ resolveActiveLanding: mocks.landing }));
vi.mock("@/lib/env", () => ({ readPublicEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" }) }));

import { completeEntryOAuth, entryCallbackUrl, oauthAvailability } from "./entry-oauth";

const client = { auth: { exchangeCodeForSession: mocks.exchange, signOut: mocks.signOut }, rpc: mocks.rpc } as never;
const user = { id: "u1", user_metadata: { full_name: "Mona Adel" } };

/** A registration state machine that advances the way the database does. */
function database(start: string, allowed = true) {
  let state = start;
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "my_registration_state") return { data: state, error: null };
    if (name === "record_consent") state = "account_type_pending";
    if (name === "onboarding_select_account_type") state = "username_pending";
    if (name === "profile_set_username") state = "access_ready";
    if (name === "account_entry_allowed") return { data: allowed, error: null };
    return { data: null, error: null };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exchange.mockResolvedValue({ data: { user }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.landing.mockResolvedValue("/home");
});

describe("completeEntryOAuth", () => {
  it("creates a showroom account for a brand-new Google/Facebook person", async () => {
    database("consent_pending");
    expect(await completeEntryOAuth(client, { code: "c", kind: "showroom", next: null, providerError: null })).toEqual({ path: "/onboarding/business" });
    expect(mocks.exchange).toHaveBeenCalledWith("c");
    expect(mocks.rpc).toHaveBeenCalledWith("onboarding_select_account_type", { p_track: "business", p_account_type: "showroom_dealer" });
    expect(mocks.rpc).toHaveBeenCalledWith("profile_set_display_name", { p_display_name: "Mona Adel" });
    expect(mocks.rpc.mock.calls.find(([name]) => name === "profile_set_username")?.[1]).toEqual({ p_username: expect.stringMatching(/^showroom\./) });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "my_registration_state", "record_consent", "my_registration_state", "onboarding_select_account_type",
      "my_registration_state", "account_entry_allowed", "profile_set_display_name", "profile_set_username",
    ]);
  });

  it("creates an installer account for a brand-new person on the installer pages", async () => {
    database("consent_pending");
    expect((await completeEntryOAuth(client, { code: "c", kind: "installer", next: null, providerError: null })).path).toBe("/home");
    expect(mocks.rpc).toHaveBeenCalledWith("onboarding_select_account_type", { p_track: "professional", p_account_type: "installer_technician" });
    expect(mocks.rpc.mock.calls.find(([name]) => name === "profile_set_username")?.[1]).toEqual({ p_username: expect.stringMatching(/^craftsman\./) });
  });

  it("signs an existing account of the right type straight in, keeping its own deep link", async () => {
    database("access_ready");
    mocks.landing.mockResolvedValue("/b2b");
    expect((await completeEntryOAuth(client, { code: "c", kind: "showroom", next: "/b2b/products", providerError: null })).path).toBe("/b2b/products");
    expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain("onboarding_select_account_type");
    expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain("record_consent");
  });

  it("keeps an account of the other type out and clears its session", async () => {
    database("access_ready", false);
    expect(await completeEntryOAuth(client, { code: "c", kind: "installer", next: null, providerError: null })).toEqual({ path: "/installer/sign-in?error=wrong_account", signedOut: true });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("returns to sign-in when the provider refused or the code is missing or bad", async () => {
    database("access_ready");
    expect((await completeEntryOAuth(client, { code: "c", kind: "showroom", next: null, providerError: "access_denied" })).path).toBe("/sign-in?error=oauth");
    expect((await completeEntryOAuth(client, { code: null, kind: "showroom", next: null, providerError: null })).path).toBe("/sign-in?error=oauth");
    mocks.exchange.mockResolvedValue({ data: { user: null }, error: { code: "bad_code_verifier" } });
    expect((await completeEntryOAuth(client, { code: "c", kind: "installer", next: null, providerError: null })).path).toBe("/installer/sign-in?error=oauth");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses an identity without a confirmed email", async () => {
    database("unverified");
    expect((await completeEntryOAuth(client, { code: "c", kind: "showroom", next: null, providerError: null })).path).toBe("/sign-in?error=oauth_email");
    expect(mocks.signOut).toHaveBeenCalled();
  });

  it("sends a suspended account to the suspended page", async () => {
    database("manually_blocked");
    expect((await completeEntryOAuth(client, { code: "c", kind: "showroom", next: null, providerError: null })).path).toBe("/auth/suspended");
  });

  it("signs out when setting up the new account fails", async () => {
    database("consent_pending");
    const base = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (name: string, args: unknown) => (name === "onboarding_select_account_type" ? { data: null, error: { code: "XX000" } } : base(name, args)));
    expect((await completeEntryOAuth(client, { code: "c", kind: "showroom", next: null, providerError: null })).path).toBe("/sign-in?error=oauth");
    expect(mocks.signOut).toHaveBeenCalled();
  });
});

describe("entryCallbackUrl", () => {
  it("carries only the kind and an allow-listed next", () => {
    expect(entryCallbackUrl("https://aladdindecore.com", "showroom", "/b2b/products")).toBe("https://aladdindecore.com/auth/callback?entry=showroom&next=%2Fb2b%2Fproducts");
    expect(entryCallbackUrl("https://aladdindecore.com", "installer", "https://evil.test")).toBe("https://aladdindecore.com/auth/callback?entry=installer");
  });
});

describe("oauthAvailability", () => {
  it("reads which providers Supabase has switched on", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ external: { google: true, facebook: false } })));
    expect(await oauthAvailability(fetcher as never)).toEqual({ google: true, facebook: false });
    expect(fetcher).toHaveBeenCalledWith("https://project.supabase.test/auth/v1/settings", expect.objectContaining({ headers: { apikey: "anon" } }));
  });

  it("shows no buttons when Supabase cannot be reached", async () => {
    expect(await oauthAvailability((async () => { throw Error("down"); }) as never)).toEqual({ google: false, facebook: false });
    expect(await oauthAvailability((async () => new Response("", { status: 500 })) as never)).toEqual({ google: false, facebook: false });
  });
});
