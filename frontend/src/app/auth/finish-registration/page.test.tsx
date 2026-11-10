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
  FinishRegistrationScreen: (props: unknown) => ({ type: "screen", props }),
}));

import FinishRegistrationPage from "./page";
import { getRegistrationState } from "@/server/queries/registration";

async function run(reason?: string) {
  try {
    const el = (await FinishRegistrationPage({ searchParams: Promise.resolve(reason ? { reason } : {}) })) as {
      props: { needsAccountType: boolean; usernameUnavailable: boolean };
    };
    return el.props;
  } catch (e) {
    return (e as { to?: string }).to;
  }
}

describe("finish-registration page — reason only picks copy, state decides access", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a retired username_pending value is not a known state: it never shows username copy", async () => {
    vi.mocked(getRegistrationState).mockResolvedValue("username_pending" as never);
    expect(await run("username_unavailable")).toBe("/onboarding");
  });

  it("the reason cannot bypass anything: an access_ready caller is sent to the app", async () => {
    vi.mocked(getRegistrationState).mockResolvedValue("access_ready");
    expect(await run("username_unavailable")).toBe("/home");
  });

  it("account_type_pending asks for the account type and never shows the username copy, whatever the legacy reason says", async () => {
    vi.mocked(getRegistrationState).mockResolvedValue("account_type_pending");
    expect(await run("username_unavailable")).toEqual({ needsAccountType: true, usernameUnavailable: false });
    expect(await run()).toEqual({ needsAccountType: true, usernameUnavailable: false });
  });
});
