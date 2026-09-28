import { fireEvent, screen } from "@testing-library/react";
import { createElement, type ImgHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { mockOpportunities } from "./mock-data";
import { JobOpportunitiesSection } from "./job-opportunities-section";

vi.mock("next/image", () => ({
  default: ({ fill: _fill, priority: _priority, sizes: _sizes, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean; sizes?: string }) => {
    void _fill; void _priority; void _sizes;
    return createElement("img", { ...props, alt: props.alt ?? "" });
  },
}));

describe("JobOpportunitiesSection date sorting", () => {
  it("uses a styled radio menu and visibly activates the date sort", () => {
    renderWithI18n(
      <JobOpportunitiesSection opportunities={mockOpportunities()} emptyTitle="Empty" emptyBody="None" />,
      "ar",
    );

    const trigger = screen.getByRole("button", { name: "ترتيب حسب التاريخ" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveClass("bg-surface");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu", { name: "ترتيب حسب التاريخ" })).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: "الأحدث" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("menuitemradio", { name: "الأقدم" }));
    expect(trigger).toHaveTextContent("الأقدم");
    expect(trigger).toHaveClass("bg-primary", "text-primary-foreground");
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
