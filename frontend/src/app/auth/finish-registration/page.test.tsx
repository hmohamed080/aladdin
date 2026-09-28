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

  it("username_pending + reason=username_unavailable → explicit collision copy", async () => {
    vi.mocked(getRegistrationState).mockResolvedValue("username_pending");
    expect(await run("username_unavailable")).toEqual({ needsAccountType: false, usernameUnavailable: true });
  });

  it("username_pending without (or with an unknown) reason → generic copy", async () => {
    vi.mocked(getRegistrationState).mockResolvedValue("username_pending");
    expect(await run()).toEqual({ needsAccountType: false, usernameUnavailable: false });
    expect(await run("anything_else")).toEqual({ needsAccountType: false, usernameUnavailable: false });
  });

  it("the reason cannot bypass anything: an access_ready caller is sent to the app", async () => {
    vi.mocked(getRegistrationState).mockResolvedValue("access_ready");
    expect(await run("username_unavailable")).toBe("/home");
  });

  it("account_type_pending never shows the username copy", async () => {
    vi.mocked(getRegistrationState).mockResolvedValue("account_type_pending");
    expect(await run("username_unavailable")).toEqual({ needsAccountType: true, usernameUnavailable: false });
  });
});
