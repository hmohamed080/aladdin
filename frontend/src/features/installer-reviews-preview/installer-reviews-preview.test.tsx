import { fireEvent, screen } from "@testing-library/react";
import { createElement, type ImgHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { InstallerReviewsPreview } from "./installer-reviews-preview";

vi.mock("next/navigation", () => ({
  usePathname: () => "/preview/installer-reviews",
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

describe("InstallerReviewsPreview", () => {
  it("renders every reference region in Arabic", () => {
    renderWithI18n(<InstallerReviewsPreview theme="light" sidebarMode="expanded" />, "ar");
    expect(screen.getByRole("heading", { name: "تقييماتي", level: 1 })).toBeTruthy();
    expect(screen.getAllByRole("img", { name: "4.8 من 5 نجوم" }).length).toBeGreaterThan(0);
    expect(screen.getByTestId("rating-distribution")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "ملخص تقييماتك" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "أكثر ما يعجب عملائك" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "تطور تقييماتك" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "نصائح لتحسين تقييماتك" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "عرض المزيد" })).toBeTruthy();
  });

  it("filters the preview review list with the compact search", () => {
    renderWithI18n(<InstallerReviewsPreview theme="light" sidebarMode="expanded" />, "en");
    expect(screen.getByText("Sara Abdallah")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search your reviews"), { target: { value: "villa" } });
    expect(screen.queryByText("Sara Abdallah")).toBeNull();
    expect(screen.getByText("Mohamed Ahmed")).toBeTruthy();
  });

  it("reveals more reviews and switches between list and grid views", () => {
    renderWithI18n(<InstallerReviewsPreview theme="light" sidebarMode="expanded" />, "en");
    expect(screen.getByTestId("reviews-results-viewport").className).toContain("desktop:overflow-y-auto");
    expect(screen.getByText("Mohamed Ahmed")).toBeTruthy();
    expect(screen.getByText("Reem Khaled")).toBeTruthy();
    expect(screen.queryByText("Omar Hassan")).toBeNull();
    expect(screen.getByText("Showing 6 of 15 results")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View more" }));
    expect(screen.getByText("Mohamed Ahmed")).toBeTruthy();
    expect(screen.getByText("Omar Hassan")).toBeTruthy();
    expect(screen.queryByText("Amr Nabil")).toBeNull();
    expect(screen.getByText("Showing 12 of 15 results")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View more" }));
    expect(screen.getByText("Tarek Mansour")).toBeTruthy();
    expect(screen.getByText("Showing 15 of 15 results")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View more" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(screen.getByRole("button", { name: "Grid" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("omits the unnecessary saved-search management toolbar", () => {
    renderWithI18n(<InstallerReviewsPreview theme="light" sidebarMode="expanded" />, "en");
    expect(screen.queryByRole("button", { name: "New search" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Saved searches" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save search" })).toBeNull();
    expect(screen.queryByRole("button", { name: "All filters" })).toBeNull();
  });

  it("keeps export and incremental reveal quiet without transient notices", () => {
    renderWithI18n(<InstallerReviewsPreview theme="dark" sidebarMode="expanded" />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Export report" }));
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View more" }));
    expect(screen.getByText("Reem Khaled")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
