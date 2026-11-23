import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`REDIRECT ${to}`), { to });
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } })),
}));
vi.mock("@/server/queries/registration", () => ({ getRegistrationState: vi.fn() }));
vi.mock("@/server/queries/landing", () => ({ activeLandingPath: vi.fn(async () => "/home") }));
vi.mock("@/features/auth-password-preview/finish-registration-screen", () => ({
  FinishRegistrationScreen: () => "screen",
}));

import FinishRegistrationPage from "./page";
import { getRegistrationState } from "@/server/queries/registration";

async function run(): Promise<"screen" | string | undefined> {
  try {
    const el = (await FinishRegistrationPage()) as { type: () => string };
    return el.type();
  } catch (e) {
    return (e as { to?: string }).to;
  }
}

describe("finish-registration page — state decides access", () => {
  beforeEach(() => vi.clearAllMocks());

  it("account_type_pending shows the account-type screen", async () => {
    vi.mocked(getRegistrationState).mockResolvedValue("account_type_pending");
    expect(await run()).toBe("screen");
  });

  it("an access_ready caller is sent to the app", async () => {
    vi.mocked(getRegistrationState).mockResolvedValue("access_ready");
    expect(await run()).toBe("/home");
  });

  it("a legacy username_pending state (pre-M1 database) is not handled here: it goes to /onboarding", async () => {
    vi.mocked(getRegistrationState).mockResolvedValue("username_pending" as never);
    expect(await run()).toBe("/onboarding");
  });
});
