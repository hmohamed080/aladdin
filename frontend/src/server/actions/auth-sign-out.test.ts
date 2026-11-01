import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));

const getUser = vi.fn();
const signOutSpy = vi.fn(async () => ({ error: null }));
const rpcSpy = vi.fn(async () => ({ data: 0, error: null }));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: vi.fn(async () => ({ auth: { getUser, signOut: signOutSpy }, rpc: rpcSpy })),
}));
vi.mock("@/server/queries/landing", () => ({ resolveActiveLanding: vi.fn() }));

import { signOut } from "./auth";

async function run(): Promise<string> {
  try {
    await signOut();
    return "no redirect";
  } catch (error) {
    return (error as Error).message;
  }
}

beforeEach(() => vi.clearAllMocks());

it("returns a showroom phone account to its own sign-in entry", async () => {
  getUser.mockResolvedValue({ data: { user: { email: "p201012345678@craftsman-login.aladdin.invalid", app_metadata: { registration_source: "temporary_showroom_password_flow" } } } });
  expect(await run()).toBe("REDIRECT:/showroom/sign-in");
});

describe("signOut — returns each account to the sign-in page it can use", () => {
  it("sends an installer phone + password account to /installer/sign-in", async () => {
    getUser.mockResolvedValue({ data: { user: { email: "p201012345678@craftsman-login.aladdin.invalid" } } });
    expect(await run()).toBe("REDIRECT:/installer/sign-in");
    expect(signOutSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps every email account on /auth/sign-in, exactly as before", async () => {
    getUser.mockResolvedValue({ data: { user: { email: "hossam@example.test" } } });
    expect(await run()).toBe("REDIRECT:/auth/sign-in");
  });

  it("falls back to /auth/sign-in when there is no session to read", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await run()).toBe("REDIRECT:/auth/sign-in");
    expect(signOutSpy).toHaveBeenCalledTimes(1);
  });
});

describe("signOut — Admin View-As sessions", () => {
  it("does nothing extra while the feature is off (a normal sign-out is unchanged)", async () => {
    getUser.mockResolvedValue({ data: { user: { email: "a@b.co" } } });
    await run();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("closes every live view session before signing out when the feature is on", async () => {
    vi.stubEnv("ADMIN_VIEW_AS_ENABLED", "true");
    getUser.mockResolvedValue({ data: { user: { email: "a@b.co" } } });
    try {
      expect(await run()).toBe("REDIRECT:/auth/sign-in");
      expect(rpcSpy).toHaveBeenCalledWith("admin_view_as_end_all");
      expect(rpcSpy.mock.invocationCallOrder[0]).toBeLessThan(signOutSpy.mock.invocationCallOrder[0]!);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("never blocks sign-out if closing the sessions fails", async () => {
    vi.stubEnv("ADMIN_VIEW_AS_ENABLED", "true");
    rpcSpy.mockRejectedValueOnce(new Error("db down"));
    getUser.mockResolvedValue({ data: { user: { email: "a@b.co" } } });
    try {
      expect(await run()).toBe("REDIRECT:/auth/sign-in");
      expect(signOutSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
