import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));

const redirectError = (to: string) => Object.assign(new Error(`REDIRECT ${to}`), { to });
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw redirectError(to);
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "en" }) }) }));
vi.mock("@/server/queries/registration", () => ({
  getRegistrationState: vi.fn(),
  hasAppAccess: (s: string) => s === "active_personal" || s === "access_ready",
}));
vi.mock("@/server/queries/landing", () => ({ activeLandingPath: vi.fn(async () => "/home") }));
vi.mock("@/server/queries/profile-identity", () => ({
  loadMyIdentity: vi.fn(),
  loadMyProfileCompletion: vi.fn(async () => ({ percent: 20, missing: ["avatar"] })),
}));
// Workspace resolution must NOT be a prerequisite of this route.
vi.mock("@/server/queries/workspace", () => ({ loadWorkspaces: vi.fn(), getWorkspaces: vi.fn() }));
vi.mock("@/features/settings/identity-card", () => ({
  IdentityCard: ({ identity }: { identity: { displayName: string } }) => (
    <div data-testid="identity-card-stub">{identity.displayName}</div>
  ),
}));
vi.mock("@/features/profile/complete-profile-card", () => ({
  CompleteProfileCard: () => <div data-testid="completion-stub" />,
}));

import ProfileSettingsPage from "./page";
import { getRegistrationState } from "@/server/queries/registration";
import { loadMyIdentity } from "@/server/queries/profile-identity";
import { loadWorkspaces, getWorkspaces } from "@/server/queries/workspace";

const identity = {
  displayName: "Zero Org Owner",
  displayNameConfirmed: false,
  username: "zeroorg",
  phoneCountryIso2: null,
  phoneNational: null,
  phoneE164: null,
  avatarUrl: null,
};

async function outcome(): Promise<string> {
  try {
    render(await ProfileSettingsPage());
    return "rendered";
  } catch (e) {
    return (e as { to?: string }).to ?? String(e);
  }
}

describe("/settings/profile — workspace-independent identity settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadMyIdentity).mockResolvedValue(identity as never);
  });

  it("renders for access_ready WITHOUT resolving any workspace (zero organizations, no personal persona)", async () => {
    vi.mocked(getRegistrationState).mockResolvedValue("access_ready");
    expect(await outcome()).toBe("rendered");
    expect(screen.getByTestId("identity-card-stub").textContent).toBe("Zero Org Owner");
    expect(screen.getByTestId("completion-stub")).toBeTruthy();
    expect(loadWorkspaces).not.toHaveBeenCalled();
    expect(getWorkspaces).not.toHaveBeenCalled();
  });

  it("renders for active_personal too", async () => {
    vi.mocked(getRegistrationState).mockResolvedValue("active_personal");
    expect(await outcome()).toBe("rendered");
  });

  it.each([
    ["unverified", "/auth/sign-in"],
    ["consent_pending", "/onboarding"],
    ["account_type_pending", "/onboarding"],
    ["username_pending", "/onboarding"],
    ["manually_blocked", "/onboarding"],
  ] as const)("%s is sent to %s", async (state, to) => {
    vi.mocked(getRegistrationState).mockResolvedValue(state);
    expect(await outcome()).toBe(to);
  });
});
