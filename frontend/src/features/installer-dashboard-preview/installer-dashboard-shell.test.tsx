import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { InstallerDashboardShell } from "./installer-dashboard-shell";

vi.mock("next/navigation", () => ({ usePathname: () => "/home", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/actions/auth", () => ({ signOut: vi.fn() }));

const shell = (props: { location: string | null }, locale: "en" | "ar" = "en") =>
  renderWithI18n(
    <InstallerDashboardShell
      theme="light"
      sidebarMode="expanded"
      displayName="Hossam"
      location={props.location}
      searchJobs={[]}
    >
      <p>page body</p>
    </InstallerDashboardShell>,
    locale,
  );

describe("InstallerDashboardShell (production installer chrome)", () => {
  it("scopes the approved Installer palette to its own wrapper, so no other persona's chrome changes", () => {
    const { container } = shell({ location: "Cairo" });
    const root = container.firstElementChild as HTMLElement;
    expect(root.classList.contains("installer-surface")).toBe(true);
    expect(root.textContent).toContain("page body");
  });

  it("carries the mobile controls in production: search, theme, language and the service area", () => {
    const { container } = shell({ location: "Nasr City، Cairo" });
    expect(screen.getByTestId("installer-search-trigger")).toBeTruthy();
    expect(screen.getByRole("button", { name: /dark|light|theme/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /language/i })).toBeTruthy();
    // The real service area appears in the phone row (and in the desktop slot).
    expect(container.textContent).toContain("Nasr City، Cairo");
  });

  it("states a missing service area honestly instead of showing a made-up place", () => {
    const { container } = shell({ location: null });
    expect(container.textContent).toContain("Service area not set");
    expect(container.textContent).not.toMatch(/Sheikh Zayed|الشيخ زايد/);
  });

  it("keeps the notification bell out of production until it has a real source", () => {
    shell({ location: "Cairo" });
    expect(screen.queryByRole("button", { name: /notifications/i })).toBeNull();
  });

  it("shows the real display name, not the preview persona", () => {
    const { container } = shell({ location: "Cairo" });
    expect(container.textContent).toContain("H");
    expect(container.textContent).not.toMatch(/أحمد|Ahmed/);
  });
});
