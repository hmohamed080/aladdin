import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { InstallerDashboardShell } from "@/features/installer-dashboard-preview/installer-dashboard-shell";
import { ViewAsScopeProvider } from "@/components/navigation/scoped-link";
import { ViewAsReadOnlyRegion } from "./view-as-read-only-region";

const ID = "70000009-0000-4000-8000-000000000009";
const path = vi.hoisted(() => ({ current: "/home" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current, useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/actions/auth", () => ({ signOut: vi.fn() }));
afterEach(cleanup);

const shell = (inView: boolean) => {
  const node = (
    <InstallerDashboardShell theme="light" sidebarMode="expanded" displayName="Ahmed" location="Cairo" searchJobs={[]}>
      <ViewAsReadOnlyRegion>
        <button type="button">Save</button>
        <a href="/elsewhere">link</a>
      </ViewAsReadOnlyRegion>
    </InstallerDashboardShell>
  );
  return renderWithI18n(inView ? <ViewAsScopeProvider base={`/view-as/${ID}`}>{node}</ViewAsScopeProvider> : node, "en");
};
const hrefs = (c: HTMLElement) => [...c.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")!);

describe("the real Craftsman shell inside the view tree", () => {
  it("renders NO href starting with /home: every navigation link is scoped to /view-as/<id>", () => {
    path.current = `/view-as/${ID}/points`;
    const { container } = shell(true);
    const all = hrefs(container);
    expect(all.length).toBeGreaterThan(5);
    expect(all.filter((h) => h.startsWith("/home"))).toEqual([]);
    expect(all).toContain(`/view-as/${ID}/points`);
    expect(all).toContain(`/view-as/${ID}`);
  });

  it("marks the matching sidebar row active from the view pathname", () => {
    path.current = `/view-as/${ID}/points`;
    const { container } = shell(true);
    const active = [...container.querySelectorAll('a[aria-current="page"]')].map((a) => a.getAttribute("href"));
    expect(active).toContain(`/view-as/${ID}/points`);
  });

  it("disables owner-only controls (sign out) and page-content buttons, while links keep working", () => {
    path.current = `/view-as/${ID}`;
    const { container } = shell(true);
    expect(screen.getByRole("button", { name: "Save" }).closest("fieldset[disabled]") !== null).toBe(true);
    const signOuts = [...container.querySelectorAll("button")].filter((b) => /sign out|تسجيل خروج/i.test(b.textContent ?? b.title));
    expect(signOuts.length).toBeGreaterThan(0);
    for (const b of signOuts) expect(b.disabled || b.closest("fieldset[disabled]") !== null, b.outerHTML).toBe(true);
    expect(container.querySelector('a[href="/elsewhere"]')).toBeTruthy();
  });

  it("is unchanged outside a view: hrefs stay /home/..., sign out is live", () => {
    path.current = "/home";
    const { container } = renderWithI18n(
      <InstallerDashboardShell theme="light" sidebarMode="expanded" displayName="Ahmed" location="Cairo" searchJobs={[]}>
        <p>body</p>
      </InstallerDashboardShell>,
      "en",
    );
    expect(hrefs(container)).toContain("/home/points");
    expect(container.querySelector("fieldset")).toBeNull();
    const signOuts = [...container.querySelectorAll("button")].filter((b) => /sign out|تسجيل خروج/i.test(b.textContent ?? b.title));
    for (const b of signOuts) expect(b.disabled || b.closest("fieldset[disabled]") !== null).toBe(false);
  });
});
