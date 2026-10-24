import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn((url: string) => { throw Error("REDIRECT:" + url); }) }));
const headerValues: Record<string, string> = { host: "aladdindecore.com", "x-forwarded-proto": "https" };
vi.mock("next/headers", () => ({ headers: vi.fn(async () => ({ get: (name: string) => headerValues[name] ?? null })) }));
const mocks = vi.hoisted(() => ({ oauth: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ auth: { signInWithOAuth: mocks.oauth } }) }));
vi.mock("@/lib/supabase/admin-server", () => ({}));
vi.mock("@/server/queries/landing", () => ({ resolveActiveLanding: vi.fn() }));

import { startEntryOAuth } from "./entry-oauth";

function form(patch: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(patch)) data.set(key, value);
  return data;
}
async function run(fn: () => Promise<unknown>) {
  try {
    return await fn();
  } catch (e) {
    return (e as Error).message;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.oauth.mockResolvedValue({ data: { url: "https://project.supabase.test/auth/v1/authorize?provider=google" }, error: null });
});

describe("startEntryOAuth", () => {
  it("sends the person to the provider with a callback on this site", async () => {
    expect(await run(() => startEntryOAuth(form({ kind: "showroom", provider: "google", next: "/b2b/offers" })))).toBe("REDIRECT:https://project.supabase.test/auth/v1/authorize?provider=google");
    expect(mocks.oauth).toHaveBeenCalledWith({
      provider: "google",
      options: expect.objectContaining({ redirectTo: "https://aladdindecore.com/auth/callback?entry=showroom&next=%2Fb2b%2Foffers", skipBrowserRedirect: true }),
    });
  });

  it("supports Facebook on the installer pages", async () => {
    await run(() => startEntryOAuth(form({ kind: "installer", provider: "facebook" })));
    expect(mocks.oauth).toHaveBeenCalledWith({ provider: "facebook", options: expect.objectContaining({ redirectTo: "https://aladdindecore.com/auth/callback?entry=installer" }) });
  });

  it("refuses an unknown provider or page", async () => {
    expect(await run(() => startEntryOAuth(form({ kind: "showroom", provider: "github" })))).toBe("REDIRECT:/sign-in?error=oauth");
    expect(await run(() => startEntryOAuth(form({ kind: "admin", provider: "google" })))).toBe("REDIRECT:/auth/sign-in");
    expect(mocks.oauth).not.toHaveBeenCalled();
  });

  it("returns with an error when Supabase cannot start the flow", async () => {
    mocks.oauth.mockResolvedValue({ data: { url: null }, error: { code: "provider_disabled" } });
    expect(await run(() => startEntryOAuth(form({ kind: "installer", provider: "google" })))).toBe("REDIRECT:/installer/sign-in?error=oauth");
  });
});
