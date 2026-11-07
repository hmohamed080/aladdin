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
function database(start: string) {
  let state = start;
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "my_registration_state") return { data: state, error: null };
    if (name === "record_consent") state = "account_type_pending";
    if (name === "onboarding_select_account_type") state = "username_pending";
    return { data: null, error: null };
  });
}

const call = (overrides: Partial<Parameters<typeof completeEntryOAuth>[1]> = {}) =>
  completeEntryOAuth(client, { code: "c", next: null, providerError: null, ...overrides });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exchange.mockResolvedValue({ data: { user }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.landing.mockResolvedValue("/home");
});

describe("completeEntryOAuth", () => {
  it("records a brand-new person's consent and sends them to finish registration", async () => {
    database("consent_pending");
    expect(await call({ locale: "ar" })).toEqual({ path: "/auth/finish-registration" });
    expect(mocks.exchange).toHaveBeenCalledWith("c");
    expect(mocks.rpc).toHaveBeenCalledWith("record_consent", { p_types: ["terms", "privacy", "pilot"], p_locale: "ar" });
    expect(mocks.rpc).toHaveBeenCalledWith("profile_set_display_name", { p_display_name: "Mona Adel" });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain("onboarding_select_account_type");
  });

  it("applies an open account type picked on the landing page", async () => {
    database("consent_pending");
    expect((await call({ accountType: "showroom_dealer" })).path).toBe("/auth/finish-registration");
    expect(mocks.rpc).toHaveBeenCalledWith("onboarding_select_account_type", { p_track: "business", p_account_type: "showroom_dealer" });
  });

  it("ignores a Coming Soon or unknown account type", async () => {
    database("consent_pending");
    await call({ accountType: "end_consumer" });
    await call({ accountType: "owner" });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain("onboarding_select_account_type");
  });

  it("signs an existing account straight in, keeping its own deep link", async () => {
    database("access_ready");
    mocks.landing.mockResolvedValue("/b2b");
    expect((await call({ next: "/b2b/products" })).path).toBe("/b2b/products");
    expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain("record_consent");
  });

  it("returns to sign-in when the provider refused or the code is missing or bad", async () => {
    database("access_ready");
    expect((await call({ providerError: "access_denied" })).path).toBe("/auth/sign-in?error=oauth");
    expect((await call({ code: null })).path).toBe("/auth/sign-in?error=oauth");
    mocks.exchange.mockResolvedValue({ data: { user: null }, error: { code: "bad_code_verifier" } });
    expect((await call()).path).toBe("/auth/sign-in?error=oauth");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses an identity without a confirmed email", async () => {
    database("unverified");
    expect(await call()).toEqual({ path: "/auth/sign-in?error=oauth_email", signedOut: true });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("sends a suspended account to the suspended page", async () => {
    database("manually_blocked");
    expect((await call()).path).toBe("/auth/suspended");
  });

  it("signs out when the consent cannot be recorded", async () => {
    database("consent_pending");
    const base = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (name: string, args: unknown) => (name === "record_consent" ? { data: null, error: { code: "XX000" } } : base(name, args)));
    expect((await call()).path).toBe("/auth/sign-in?error=oauth");
    expect(mocks.signOut).toHaveBeenCalled();
  });
});

describe("entryCallbackUrl", () => {
  it("carries only an allow-listed next and an open account type", () => {
    expect(entryCallbackUrl("https://aladdindecore.com", "/b2b/products", "supplier")).toBe("https://aladdindecore.com/auth/callback?next=%2Fb2b%2Fproducts&type=supplier");
    expect(entryCallbackUrl("https://aladdindecore.com", "https://evil.test", "admin")).toBe("https://aladdindecore.com/auth/callback");
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
