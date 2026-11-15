import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { cleanup, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import { ViewAsBanner } from "./view-as-banner";

const ID = "70000009-0000-4000-8000-000000000009";
const show = (tree?: "interim" | "exact") =>
  render(
    <I18nProvider locale="en" dir="ltr">
      <ViewAsBanner subjectUserId={ID} subjectName="Ahmed" kind="craftsman" expiresAt="2099-11-01T15:30:00Z" tree={tree} />
    </I18nProvider>,
  );
afterEach(cleanup);

describe("ViewAsBanner tree label", () => {
  it("labels the custom view 'Interim' by default and says it is not the account's own interface", () => {
    const { container } = show();
    expect(screen.getByTestId("view-as-tree-badge").textContent).toBe("Interim");
    expect(container.textContent).toMatch(/not the account's own interface/i);
    expect(container.textContent).not.toMatch(/exact parity/i);
    expect(container.querySelector("form")!.getAttribute("action")).toBe(`/admin/users/${ID}/view/exit`);
  });

  it("the exact tree says Read only, has no interim wording and exits through /view-as", () => {
    const { container } = show("exact");
    expect(screen.getByTestId("view-as-tree-badge").textContent).toBe("Read only");
    expect(container.textContent).not.toMatch(/interim/i);
    expect(container.querySelector("form")!.getAttribute("action")).toBe(`/view-as/${ID}/exit`);
    expect(container.querySelector('a[href^="/home"]')).toBeNull();
  });
});
