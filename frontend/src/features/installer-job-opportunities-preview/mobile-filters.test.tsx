import { fireEvent, screen } from "@testing-library/react";
import { createElement, type ImgHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { InstallerJobOpportunitiesPreview } from "./installer-job-opportunities-preview";

vi.mock("next/navigation", () => ({
  usePathname: () => "/preview/installer-job-opportunities",
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

describe("installer job opportunities — mobile filters sheet", () => {
  it("opens as a dialog, closes with its button and Escape, and the trigger shows the active count", () => {
    renderWithI18n(<InstallerJobOpportunitiesPreview theme="light" sidebarMode="expanded" />, "en");

    const trigger = screen.getByRole("button", { name: "Filters" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Filter results" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close filters" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByLabelText("SPC installation"));
    expect(screen.getByRole("button", { name: /Filters/ })).toHaveTextContent("1");
  });
});
