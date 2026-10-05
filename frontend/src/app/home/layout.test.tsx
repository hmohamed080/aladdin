import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  home: null as unknown,
  entries: [] as unknown[],
  isSales: false,
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/home", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/actions/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({}) }));
vi.mock("@/server/queries/job-opportunities", () => ({ listJobOpportunities: async () => [] }));
vi.mock("@/server/queries/workspace", () => ({ getWorkspaces: async () => ({ entries: state.entries }) }));
vi.mock("@/server/queries/sales-persona", () => ({ loadIsSalesPersona: async () => state.isSales }));
vi.mock("@/server/queries/personal-home", () => ({ loadPersonalHome: async () => state.home }));

// Layout chrome that is not under test is stubbed. The generic switcher is a
// marker: it is mounted only for the approved five categories, and always
// carries "Add business activity" with it.
vi.mock("@/components/layout/workspace-switcher", () => ({
  WorkspaceSwitcher: () => <div data-testid="workspace-switcher">Workspace · Add business activity</div>,
}));
vi.mock("@/components/layout/app-header", () => ({
  AppHeader: ({ context }: { context?: ReactNode }) => <header>{context}</header>,
}));
vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ nav, header, children }: { nav?: ReactNode; header: ReactNode; children: ReactNode }) => (
    <div>
      {nav}
      {header}
      {children}
    </div>
  ),
}));
vi.mock("@/components/layout/sidebar-shell", () => ({
  SidebarShell: ({ nav }: { nav: ReactNode }) => <aside>{nav}</aside>,
}));
vi.mock("@/components/layout/personal-nav", () => ({
  PersonalNavPanel: ({ keys }: { keys: string[] }) => <nav data-testid="nav-keys">{keys.join(",")}</nav>,
  PersonalMobileNav: () => null,
}));

import HomeLayout from "./layout";

const personalEntry = (persona: string | null = null) => ({ kind: "personal", name: "Personal", persona });
const memberOf = (orgType = "showroom_dealer") => ({
  kind: "business",
  organizationId: "o1",
  name: "Nile Showroom",
  orgType,
  relationship: "member",
});

const home = (accountType: string, variant = "professional") => ({
  variant,
  displayName: "Hossam Kandil",
  accountType,
  professional: { prof_governorate: null, service_areas: [] },
});

async function renderLayout() {
  const tree = await HomeLayout({ children: <p>page body</p> });
  return render(tree as React.ReactElement);
}

describe("/home layout — workspace switcher scope and account label", () => {
  beforeEach(() => {
    state.home = null;
    state.isSales = false;
    state.entries = [personalEntry()];
  });

  describe("installer_technician (craftsman)", () => {
    it("does NOT render the workspace / business switcher or any business-context text", async () => {
      state.home = home("installer_technician");
      const { container } = await renderLayout();
      expect(container.textContent).toContain("page body");
      expect(screen.queryByTestId("workspace-switcher")).toBeNull();
      expect(container.textContent).not.toMatch(/Workspace|Add business|Connect showroom|مساحة العمل/);
    });

    it("stays switcher-free even if the account also holds memberships", async () => {
      state.home = home("installer_technician");
      state.entries = [personalEntry("installer_technician"), memberOf()];
      await renderLayout();
      expect(screen.queryByTestId("workspace-switcher")).toBeNull();
    });

    it("keeps the profile menu: My profile, Settings and Sign out", async () => {
      state.home = home("installer_technician");
      await renderLayout();
      fireEvent.click(screen.getByTestId("profile-menu-trigger"));
      const items = screen.getAllByRole("menuitem").map((el) => el.textContent);
      // The layout supplies its own provider and, with no locale cookie, resolves
      // the default (Arabic) — so the menu is asserted in that locale.
      expect(items).toEqual(["ملفي الشخصي", "الإعدادات", "تسجيل خروج"]);
      expect(screen.getByRole("menuitem", { name: "ملفي الشخصي" }).getAttribute("href")).toBe("/home/profile");
      expect(screen.getByRole("menuitem", { name: "الإعدادات" }).getAttribute("href")).toBe("/home/settings");
    });

    it("labels the person صنايعي under their name — never the legacy فني / مركّب", async () => {
      state.home = home("installer_technician");
      const { container } = await renderLayout();
      expect(screen.getByTestId("profile-menu-trigger").textContent).toContain("صنايعي");
      expect(container.textContent).not.toMatch(/فني \/ مركّب|Installer \/ Technician/);
    });
  });

  describe("personal (end_consumer)", () => {
    it("gets no generic switcher and no Add business", async () => {
      state.home = home("end_consumer", "consumer");
      const { container } = await renderLayout();
      expect(screen.queryByTestId("workspace-switcher")).toBeNull();
      expect(container.textContent).not.toMatch(/Add business/);
    });

    it("still gets no generic switcher merely because it holds a business membership", async () => {
      state.home = home("end_consumer", "consumer");
      state.entries = [personalEntry("end_consumer"), memberOf()];
      const { container } = await renderLayout();
      expect(screen.queryByTestId("workspace-switcher")).toBeNull();
      expect(container.textContent).not.toMatch(/Add business|Workspace/);
    });
  });

  describe("sales", () => {
    it("gets NO generic switcher, no Add business — with or without an affiliated workplace", async () => {
      state.home = home("sales");
      state.isSales = true;
      for (const entries of [[personalEntry("sales")], [personalEntry("sales"), memberOf()]]) {
        state.entries = entries;
        const { container, unmount } = await renderLayout();
        expect(screen.queryByTestId("workspace-switcher")).toBeNull();
        expect(container.textContent).not.toMatch(/Add business|Workspace/);
        unmount();
      }
    });

    it("keeps the real affiliation flow: the nav still carries Connect a showroom, and never Add business", async () => {
      state.home = home("sales");
      state.isSales = true;
      await renderLayout();
      const keys = screen.getByTestId("nav-keys").textContent!.split(",");
      expect(keys).toContain("connectShowroom");
      expect(keys).not.toContain("addBusiness");
    });

    it("does not offer Connect a showroom to a non-sales account", async () => {
      state.home = home("engineer");
      state.isSales = false;
      await renderLayout();
      expect(screen.getByTestId("nav-keys").textContent!.split(",")).not.toContain("connectShowroom");
    });
  });

  describe("contractor and other personas", () => {
    it.each(["contractor", "trainer", "trainee", "interior_designer"])("%s: no generic switcher, no Add business", async (accountType) => {
      state.home = home(accountType);
      state.entries = [personalEntry(accountType), memberOf()];
      await renderLayout();
      expect(screen.queryByTestId("workspace-switcher")).toBeNull();
      expect(screen.getByTestId("nav-keys").textContent!.split(",")).not.toContain("addBusiness");
    });
  });

  describe("approved categories", () => {
    it.each(["engineer", "showroom_dealer", "supplier", "manufacturer", "importer"])(
      "%s keeps the generic switcher with Add business activity",
      async (accountType) => {
        state.home = home(accountType);
        await renderLayout();
        expect(screen.getByTestId("workspace-switcher").textContent).toContain("Add business activity");
        expect(screen.getByTestId("nav-keys").textContent!.split(",")).toContain("addBusiness");
      },
    );
  });
});
