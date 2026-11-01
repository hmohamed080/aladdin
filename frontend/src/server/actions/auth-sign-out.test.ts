import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));

const signOutSpy = vi.fn(async () => ({ error: null }));
const rpcSpy = vi.fn(async () => ({ data: 0, error: null }));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: vi.fn(async () => ({ auth: { signOut: signOutSpy }, rpc: rpcSpy })),
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

describe("signOut", () => {
  it("ends the session and returns to the one sign-in page, which takes a mobile number, username or email", async () => {
    expect(await run()).toBe("REDIRECT:/auth/sign-in");
    expect(signOutSpy).toHaveBeenCalledTimes(1);
  });
});

describe("signOut — Admin View-As sessions", () => {
  it("does nothing extra while the feature is off (a normal sign-out is unchanged)", async () => {
    await run();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("closes every live view session before signing out when the feature is on", async () => {
    vi.stubEnv("ADMIN_VIEW_AS_ENABLED", "true");
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
    try {
      expect(await run()).toBe("REDIRECT:/auth/sign-in");
      expect(signOutSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
