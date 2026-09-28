import { fireEvent, screen } from "@testing-library/react";
import { createElement, type ImgHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { InstallerMyWorkPreview } from "./installer-my-work-preview";

vi.mock("next/navigation", () => ({
  usePathname: () => "/preview/installer-my-work",
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

describe("InstallerMyWorkPreview", () => {
  it("reproduces the reference regions in Arabic", () => {
    renderWithI18n(<InstallerMyWorkPreview theme="light" sidebarMode="expanded" />, "ar");
    expect(screen.getByRole("heading", { name: "شغلي", level: 1 })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "البحث في الأعمال" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "كل الفلاتر" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "تركيب SPC – فيلا" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "جميع أعمالك" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "المستندات والملفات" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "أدوات سريعة" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "ملخص شغلك" })).toBeNull();
    expect(screen.getByRole("heading", { name: "المستندات والملفات" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "أدوات سريعة" })).toBeTruthy();
  });

  it("filters the local preview rows from the status tabs", () => {
    renderWithI18n(<InstallerMyWorkPreview theme="light" sidebarMode="expanded" />, "en");
    fireEvent.click(screen.getByRole("button", { name: "All filters" }));
    expect(screen.getByRole("button", { name: "Status" }).textContent).toContain("Select");
    fireEvent.click(screen.getByRole("button", { name: "Status" }));
    fireEvent.click(screen.getByRole("option", { name: "Completed" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(screen.getAllByText("Exterior painting – villa").length).toBeGreaterThan(0);
    expect(screen.queryByText("Interior painting – apartment")).toBeNull();
  });

  it("filters work records with the date-range picker", () => {
    renderWithI18n(<InstallerMyWorkPreview theme="light" sidebarMode="expanded" />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Select date" }));
    expect(screen.getByRole("heading", { name: "Select date range" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2025-06-01" } });
    fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2025-06-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getAllByText("WPC installation – garden fence").length).toBeGreaterThan(0);
    expect(screen.queryByText("Interior painting – apartment")).toBeNull();
  });

  it("searches work records by company and exposes contact details", () => {
    renderWithI18n(<InstallerMyWorkPreview theme="light" sidebarMode="expanded" />, "en");
    expect(screen.getAllByText("010 •••• 1201").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Show full phone number" })[0]!);
    expect(screen.getAllByText("010 4827 1201").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search work" }), { target: { value: "WPC Factory" } });
    expect(screen.getAllByText("WPC installation – terrace").length).toBeGreaterThan(0);
    expect(screen.queryByText("Interior painting – apartment")).toBeNull();
    expect(screen.getByText(/Showing 2 of 2 results/)).toBeTruthy();
  });

  it("creates and reapplies a saved search", () => {
    renderWithI18n(<InstallerMyWorkPreview theme="light" sidebarMode="expanded" />, "en");
    fireEvent.click(screen.getAllByRole("button", { name: "Save search" }).at(-1)!);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Priority work" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save search" }).at(-1)!);
    fireEvent.click(screen.getByRole("button", { name: "Saved searches" }));
    expect(screen.getByRole("option", { name: "Priority work" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete: Priority work" }));
    expect(screen.queryByRole("option", { name: "Priority work" })).toBeNull();
  });

  it("reveals work history in bounded pages", () => {
    renderWithI18n(<InstallerMyWorkPreview theme="light" sidebarMode="expanded" />, "en");
    expect(screen.queryAllByText("WPC installation – garden fence")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getAllByText("WPC installation – garden fence").length).toBeGreaterThan(0);
  });

  it("updates demo progress without production actions", () => {
    renderWithI18n(<InstallerMyWorkPreview theme="dark" sidebarMode="expanded" />, "en");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("60");
    fireEvent.click(screen.getByRole("button", { name: "Update progress" }));
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("70");
  });
});
