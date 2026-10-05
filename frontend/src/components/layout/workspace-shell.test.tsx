import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/components/layout/workspace-switcher", () => ({
  WorkspaceSwitcher: () => <div data-testid="workspace-switcher">Add business activity</div>,
}));
vi.mock("@/components/layout/workplace-switcher", () => ({
  WorkplaceSwitcher: () => <div data-testid="workplace-switcher">workplaces</div>,
}));
vi.mock("@/components/layout/context-switchers", () => ({ BranchSwitcher: () => null, WorkspaceContextMobile: () => null }));
vi.mock("@/components/layout/app-header", () => ({
  AppHeader: ({ context }: { context?: ReactNode }) => <header>{context}</header>,
  HeaderSeparator: () => null,
}));
vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ header, children }: { header: ReactNode; children: ReactNode }) => (
    <div>
      {header}
      {children}
    </div>
  ),
}));
vi.mock("@/components/layout/sidebar-shell", () => ({ SidebarShell: () => null }));
vi.mock("@/components/layout/workspace-nav", () => ({ WorkspaceNavPanel: () => null, MobileNav: () => null }));
vi.mock("@/features/sales/sales-realtime", () => ({ SalesRealtime: () => null }));

import { WorkspaceShell } from "./workspace-shell";
import type { WorkspaceEntry } from "@/lib/workspace/model";
import type { WorkspaceContext } from "@/server/queries/context";

const business = (orgType: string, relationship: "owner" | "manager" | "member"): WorkspaceEntry => ({
  kind: "business",
  organizationId: "o1",
  name: "Nile",
  orgType,
  relationship,
});

async function renderShell(entries: WorkspaceEntry[], orgType = "showroom_dealer") {
  const workspace = {
    entries,
    active: {
      organizationId: "o1",
      organizationName: "Nile",
      orgType,
      capabilities: [],
      branches: [],
      activeBranchId: null,
      canManageSales: false,
    },
  } as unknown as WorkspaceContext;
  const tree = await WorkspaceShell({ workspace, children: <p>b2b body</p> });
  return render(tree as React.ReactElement);
}

describe("B2B WorkspaceShell — workplace access is kept apart from the generic switcher entitlement", () => {
  it("an employee or manager keeps moving between their workplaces, with NO generic switcher or Add business", async () => {
    for (const relationship of ["member", "manager"] as const) {
      const { container, unmount } = await renderShell([business("showroom_dealer", relationship)]);
      expect(screen.getByTestId("workplace-switcher"), relationship).toBeTruthy();
      expect(screen.queryByTestId("workspace-switcher")).toBeNull();
      expect(container.textContent).not.toMatch(/Add business/);
      unmount();
    }
  });

  it("a salesperson inside a showroom gets the workplace control, never the generic switcher", async () => {
    await renderShell([{ kind: "personal", name: "P", persona: "sales" }, business("showroom_dealer", "member")]);
    expect(screen.getByTestId("workplace-switcher")).toBeTruthy();
    expect(screen.queryByTestId("workspace-switcher")).toBeNull();
  });

  it.each(["showroom_dealer", "supplier", "manufacturer", "importer"])(
    "the owner of a %s keeps the generic switcher with Add business activity",
    async (orgType) => {
      await renderShell([business(orgType, "owner")], orgType);
      expect(screen.getByTestId("workspace-switcher").textContent).toBe("Add business activity");
      expect(screen.queryByTestId("workplace-switcher")).toBeNull();
    },
  );

  it("an engineer working in a business keeps the generic switcher", async () => {
    await renderShell([{ kind: "personal", name: "P", persona: "engineer" }, business("design_office", "member")], "design_office");
    expect(screen.getByTestId("workspace-switcher")).toBeTruthy();
  });
});
