import { fireEvent, screen } from "@testing-library/react";
import { createElement, type ImgHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { InstallerNetworkPreview } from "./installer-network-preview";

vi.mock("next/navigation", () => ({
  usePathname: () => "/preview/installer-network",
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

describe("InstallerNetworkPreview", () => {
  it("renders the complete reference structure in Arabic", () => {
    renderWithI18n(<InstallerNetworkPreview theme="light" sidebarMode="expanded" />, "ar");

    expect(screen.getByRole("heading", { name: "معارفي من المعارض", level: 1 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "أضف معرضًا تعرفه واكسب نقاطًا" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "قائمة المعارض", level: 2 })).toBeTruthy();
    expect(screen.getByText("المعرض")).toBeTruthy();
    expect(screen.getByText("العلاقة")).toBeTruthy();
    expect(screen.getByText("التواصل")).toBeTruthy();
    expect(screen.getByText("إجراء سريع")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "نقاط المعارف" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "كيف تكسب النقاط؟" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "المعارض في انتظار الدعوة" })).toBeTruthy();
    expect(screen.getAllByTestId("network-showroom-row")).toHaveLength(6);
    expect(screen.getByRole("button", { name: "عرض المزيد" })).toBeTruthy();
  });

  it("keeps the English preview fully localized", () => {
    renderWithI18n(<InstallerNetworkPreview theme="dark" sidebarMode="expanded" />, "en");

    expect(screen.getByRole("heading", { name: "My showroom network", level: 1 })).toBeTruthy();
    expect(screen.getByPlaceholderText("Search by showroom or area...")).toBeTruthy();
    expect(screen.getByText("Elite Decor Showroom")).toBeTruthy();
    expect(screen.queryByText("معارفي من المعارض")).toBeNull();
  });

  it("filters locally by search, area, and relationship tab", () => {
    renderWithI18n(<InstallerNetworkPreview theme="light" sidebarMode="expanded" />, "en");

    fireEvent.change(screen.getByPlaceholderText("Search by showroom or area..."), { target: { value: "Marble" } });
    expect(screen.getByText("Marble Pro")).toBeTruthy();
    expect(screen.queryByText("Modern Floors")).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("Search by showroom or area..."), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Nasr City" }));
    expect(screen.getByText("Al Ahram Decor Showroom")).toBeTruthy();
    expect(screen.queryByText("Elite Decor Showroom")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Awaiting invitation (7)" }));
    expect(screen.queryAllByTestId("network-pending-row")).toHaveLength(0);
    expect(screen.getByText("No matching showrooms")).toBeTruthy();
  });

  it("shows additional fixtures and links to the showroom referral preview", () => {
    renderWithI18n(<InstallerNetworkPreview theme="light" sidebarMode="expanded" />, "en");

    fireEvent.click(screen.getByRole("button", { name: "View more" }));
    expect(screen.getAllByTestId("network-showroom-row")).toHaveLength(10);
    expect(screen.getAllByTestId("network-pending-row")).toHaveLength(2);

    expect(screen.getByRole("link", { name: "Add a showroom I know" })).toHaveAttribute(
      "href",
      "/preview/installer-network/refer",
    );
  });
});
