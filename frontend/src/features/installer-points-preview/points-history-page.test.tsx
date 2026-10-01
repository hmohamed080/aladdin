import { fireEvent, screen } from "@testing-library/react";
import { createElement, type ImgHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { PointsHistoryPage } from "./points-history-page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/preview/installer-points/history",
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

describe("PointsHistoryPage", () => {
  it("renders the Arabic history ledger with the reference structure", () => {
    renderWithI18n(<PointsHistoryPage theme="light" sidebarMode="expanded" />, "ar");

    expect(screen.getByRole("heading", { name: "سجل النقاط", level: 1 })).toBeTruthy();
    expect(screen.getAllByText("إجمالي النقاط")).toHaveLength(1);
    expect(screen.getByText("المستوى الذهبي")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /التاريخ/ })).toBeTruthy();
    expect(screen.getAllByText("12 مارس 2025").length).toBeGreaterThan(0);
    expect(screen.getAllByText("+200").length).toBeGreaterThan(0);
    expect(screen.getByRole("navigation", { name: "صفحات سجل النقاط" })).toBeTruthy();
    expect(screen.getByText("عرض 10 من 48 نتيجة")).toBeTruthy();
  });

  it("filters the preview fixture locally", () => {
    renderWithI18n(<PointsHistoryPage theme="light" sidebarMode="expanded" />, "ar");

    fireEvent.click(screen.getByRole("button", { name: "كل الفترات" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "من 1 فبراير 2025 إلى 28 فبراير 2025" }));
    expect(screen.getByText("عرض 5 من 48 نتيجة")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "الكل" })[0]!);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "التقييم" }));
    expect(screen.getByText("عرض 2 من 48 نتيجة")).toBeTruthy();
  });

  it("keeps the English page fully localized and labels preview export honestly", () => {
    renderWithI18n(<PointsHistoryPage theme="dark" sidebarMode="expanded" />, "en");

    expect(screen.getByRole("heading", { name: "Points history", level: 1 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export history" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Export history" }));
    expect(screen.getByText("Export is unavailable in this preview")).toBeTruthy();
    expect(screen.queryByText("سجل النقاط")).toBeNull();
  });
});
