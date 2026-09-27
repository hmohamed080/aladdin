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
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: vi.fn(async () => ({ auth: { getUser, signOut: signOutSpy } })),
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
