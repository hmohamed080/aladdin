import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));

const signOutSpy = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: vi.fn(async () => ({ auth: { signOut: signOutSpy } })),
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
