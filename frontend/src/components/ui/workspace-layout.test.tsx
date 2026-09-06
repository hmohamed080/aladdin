import { describe, expect, it } from "vitest";
import { renderWithI18n } from "@/test/render";
import { PageHeader } from "./workspace-layout";

/**
 * `PageHeader`'s primary `action` regression (Copilot review, PR #40).
 *
 * It used to render a `<Link>` (anchor) wrapping a `<Button>` (button) — two
 * nested interactive elements, which is invalid HTML and leaves a
 * keyboard/screen-reader user with two focusable stops acting as one. It must
 * render as exactly ONE focusable, anchor-shaped control that still carries
 * the label, the icon and the real `href` — `ButtonLink`, not a styled button
 * inside a link.
 */
describe("PageHeader action (no nested interactive elements)", () => {
  it("renders the primary action as a single anchor, not a button nested in a link", () => {
    const { container } = renderWithI18n(
      <PageHeader
        title="Products"
        locale="en"
        action={{ href: "/b2b/products/new", label: "Add product" }}
      />,
      "en",
    );

    // Exactly one focusable control for the action, and it is the anchor itself.
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0]!.querySelector("button")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(0);

    expect(links[0]).toHaveAttribute("href", "/b2b/products/new");
    expect(links[0]!.textContent).toContain("Add product");
  });

  it("carries the leading icon inside the single anchor", () => {
    const { container } = renderWithI18n(
      <PageHeader title="Jobs" locale="en" action={{ href: "/b2b/jobs/new", label: "Post a job" }} />,
      "en",
    );
    const link = container.querySelector("a")!;
    expect(link.querySelector("svg")).not.toBeNull();
  });

  it("renders no action at all when none is passed", () => {
    const { container } = renderWithI18n(<PageHeader title="Reports" locale="en" />, "en");
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });
});
