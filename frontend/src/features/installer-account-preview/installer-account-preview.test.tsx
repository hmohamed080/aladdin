import { screen } from "@testing-library/react";
import { createElement, type ImgHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { InstallerAccountPreview } from "./installer-account-preview";

vi.mock("next/navigation", () => ({ usePathname: () => "/preview/installer-account", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/actions/auth", () => ({ signOut: vi.fn() }));
vi.mock("next/image", () => ({
  default: ({ fill: _fill, priority: _priority, sizes: _sizes, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean; sizes?: string }) => {
    void _fill; void _priority; void _sizes;
    return createElement("img", { ...props, alt: props.alt ?? "" });
  },
}));

describe("InstallerAccountPreview", () => {
  it("renders the Arabic account hierarchy and correct preview links", () => {
    renderWithI18n(<InstallerAccountPreview theme="light" sidebarMode="expanded" />, "ar");

    expect(screen.getByRole("heading", { name: "حسابي", level: 1 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "أحمد محمود", level: 2 })).toBeTruthy();
    expect(screen.getAllByText("4,850")).toHaveLength(2);
    expect(screen.getByText("18")).toBeTruthy();
    const moduleLinks = screen.getAllByRole("link", { name: "دخول" });
    expect(moduleLinks.some((link) => link.getAttribute("href") === "/preview/installer-network")).toBe(true);
    expect(moduleLinks.some((link) => link.getAttribute("href") === "/preview/installer-reviews")).toBe(true);
    expect(screen.getByLabelText("المساعدة والدعم")).toBeTruthy();
  });

  it("keeps all major account regions localized in English", () => {
    renderWithI18n(<InstallerAccountPreview theme="dark" sidebarMode="expanded" />, "en");

    expect(screen.getByRole("heading", { name: "My account", level: 1 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ahmed Mahmoud", level: 2 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "My showroom network" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "My skills & certificates" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Learning & training" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "My reviews" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "My points & rewards" })).toBeTruthy();
    expect(screen.queryByText("حسابي")).toBeNull();
  });
});
