import { screen } from "@testing-library/react";
import { createElement, type ImgHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { InstallerPointsPreview } from "./installer-points-preview";

vi.mock("next/navigation", () => ({
  usePathname: () => "/preview/installer-points",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/server/actions/auth", () => ({ signOut: vi.fn() }));
vi.mock("next/image", () => ({
  default: ({ fill: _fill, priority: _priority, sizes: _sizes, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean; sizes?: string }) => {
    void _fill;
    void _priority;
    void _sizes;
    return createElement("img", { ...props, alt: props.alt ?? "" });
  },
}));

describe("InstallerPointsPreview", () => {
  it("matches the complete Arabic points-and-rewards content model", () => {
    renderWithI18n(<InstallerPointsPreview theme="light" sidebarMode="expanded" />, "ar");

    expect(screen.getByRole("heading", { name: "نقاطي ومكافآتي", level: 1 })).toBeTruthy();
    expect(screen.getByText("1,250")).toBeTruthy();
    expect(screen.getByText("فضي")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1250");
    expect(screen.getByRole("heading", { name: "مصادر النقاط" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "سجل النقاط الأخير" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "عرض الكل" })).toHaveAttribute("href", "/preview/installer-points/history");
    expect(screen.getByRole("heading", { name: "مكافآتي" })).toBeTruthy();
    expect(screen.getAllByText("إضافة معرض")).toHaveLength(2);
    expect(screen.getAllByText("إثبات انتهاء الشغل")).toHaveLength(2);
    expect(screen.getByText("قسيمة خصم")).toBeTruthy();
    expect(screen.getByText("ترويج ملفك الشخصي")).toBeTruthy();
    expect(screen.getByText("شهادة إنجاز معتمدة")).toBeTruthy();
  });

  it("keeps the English experience fully localized", () => {
    renderWithI18n(<InstallerPointsPreview theme="dark" sidebarMode="expanded" />, "en");

    expect(screen.getByRole("heading", { name: "My points & rewards", level: 1 })).toBeTruthy();
    expect(screen.getByText("Silver")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ways to earn points" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Recent points history" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "View all" })).toHaveAttribute("href", "/preview/installer-points/history");
    expect(screen.getByRole("heading", { name: "My rewards" })).toBeTruthy();
    expect(screen.queryByText("مصادر النقاط")).toBeNull();
  });

  it("labels preview-only rewards honestly", () => {
    renderWithI18n(<InstallerPointsPreview theme="light" sidebarMode="expanded" />, "en");

    expect(screen.getByText("Shown rewards are design examples and are not active benefits yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /redeem/i })).toBeNull();
  });
});
