import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  workspace: { active: null, entries: [] } as { active: unknown; entries: unknown[] },
  mandatory: { required: false, orgType: null } as { required: boolean; orgType: string | null },
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({}) }));
vi.mock("@/server/queries/context", () => ({ loadWorkspaceContext: async () => state.workspace }));
vi.mock("@/server/queries/business-setup", () => ({ loadMandatoryBusinessSetup: async () => state.mandatory }));
vi.mock("@/server/queries/organization-i18n", () => ({ orgBilingualNames: async () => ({}) }));
vi.mock("@/components/layout/workspace-shell", () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div data-testid="shell">{children}</div>,
}));
vi.mock("@/components/layout/no-org-notice", () => ({ NoOrgNotice: () => <div data-testid="no-org-notice" /> }));

import B2BLayout from "./layout";

// rc2: the layout now (transitively) imports the Showroom shell context, which is server-only.
vi.mock("server-only", () => ({}));

const personal = { kind: "personal", name: "P", persona: "sales" };
const active = { organizationId: "o1", organizationName: "Nile", activeBranchId: null, branches: [] };

beforeEach(() => {
  state.workspace = { active: null, entries: [] };
  state.mandatory = { required: false, orgType: null };
});

describe("/b2b layout - callers without an active workspace", () => {
  it("a business registration whose first business is outstanding goes to the mandatory setup, not the 'no workspace' notice", async () => {
    state.mandatory = { required: true, orgType: "supplier" };
    await expect(B2BLayout({ children: null })).rejects.toThrow("REDIRECT:/onboarding/business");
  });

  it("someone with a Personal home still goes to /home (unchanged)", async () => {
    state.workspace = { active: null, entries: [personal] };
    state.mandatory = { required: true, orgType: "supplier" }; // never consulted: they have a personal home
    await expect(B2BLayout({ children: null })).rejects.toThrow("REDIRECT:/home");
  });

  it("anyone else without a workspace still gets the account-safe notice (unchanged)", async () => {
    render(await B2BLayout({ children: <p>page</p> }));
    expect(screen.getByTestId("no-org-notice")).toBeInTheDocument();
  });

  it("a caller WITH an active workspace is never redirected to setup and renders the shell", async () => {
    state.workspace = { active, entries: [] };
    state.mandatory = { required: true, orgType: "supplier" };
    render(await B2BLayout({ children: <p>page</p> }));
    expect(screen.getByTestId("shell")).toBeInTheDocument();
  });

  // The Showroom frame is drawn by the (workspace) layout above this one so it survives moves between /showroom and /b2b.
  // Drawing the workspace shell (or a second Showroom frame) here would put two shells on the page for a dealer.
  it("a showroom dealer passes through: no workspace shell here, the (workspace) layout frames it", async () => {
    state.workspace = { active: { ...active, orgType: "showroom_dealer" }, entries: [] };
    render(await B2BLayout({ children: <p>page</p> }));
    expect(screen.queryByTestId("shell")).not.toBeInTheDocument();
    expect(screen.getByText("page")).toBeInTheDocument();
  });

  it("every other organization type still gets the workspace shell, unchanged", async () => {
    for (const orgType of ["supplier", "manufacturer", "importer", "design_office", null]) {
      state.workspace = { active: { ...active, orgType }, entries: [] };
      const { unmount } = render(await B2BLayout({ children: <p>page</p> }));
      expect(screen.getByTestId("shell")).toBeInTheDocument();
      unmount();
    }
  });
});
