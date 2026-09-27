import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { CompleteProfileCard, ITEM_HREF } from "./complete-profile-card";
vi.mock("server-only", () => ({}));
import { PROFILE_COMPLETION_ITEMS } from "@/server/queries/profile-identity";

describe("CompleteProfileCard", () => {
  it("shows the authoritative percentage and one link per missing item", () => {
    renderWithI18n(
      <CompleteProfileCard completion={{ percent: 40, missing: ["avatar", "phone", "display_name"] }} />,
      "en",
    );
    expect(screen.getByText("Complete your profile")).toBeTruthy();
    expect(screen.getByTestId("complete-profile-percent").textContent).toBe("40% complete");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("40");
    expect(screen.getByRole("link", { name: "Add a profile photo" }).getAttribute("href")).toBe("/settings/profile#identity");
    expect(screen.getByRole("link", { name: "Add your phone number" }).getAttribute("href")).toBe("/settings/profile#phone");
    expect(screen.getByRole("link", { name: "Confirm your display name" })).toBeTruthy();
  });

  it("disappears entirely at 100%", () => {
    const { container } = renderWithI18n(<CompleteProfileCard completion={{ percent: 100, missing: [] }} />, "en");
    expect(container.textContent).toBe("");
  });

  it("collapses the checklist but stays visible while incomplete", () => {
    renderWithI18n(<CompleteProfileCard completion={{ percent: 20, missing: ["avatar"] }} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(screen.queryByTestId("complete-profile-missing")).toBeNull();
    expect(screen.getByTestId("complete-profile-card")).toBeTruthy();
  });

  it("renders in Arabic as أكمل حسابك with no key leak", () => {
    const { container } = renderWithI18n(
      <CompleteProfileCard completion={{ percent: 60, missing: ["organization_activities"] }} />,
      "ar",
    );
    expect(screen.getByText("أكمل حسابك")).toBeTruthy();
    expect(container.textContent).not.toMatch(/completeProfile\./);
  });

  it("links every identity item to the workspace-independent /settings/profile", () => {
    // A business-intent account with zero organizations has neither /home nor
    // /b2b settings — these must never point there.
    for (const item of ["avatar", "phone", "display_name"] as const) {
      expect(ITEM_HREF[item].startsWith("/settings/profile")).toBe(true);
    }
  });

  it("points every checklist item at a route that actually exists", () => {
    const appDir = path.resolve(__dirname, "../../app");
    for (const item of PROFILE_COMPLETION_ITEMS) {
      const route = ITEM_HREF[item].split("#")[0] ?? "";
      expect(existsSync(path.join(appDir, route, "page.tsx")), `${item} -> ${route}`).toBe(true);
    }
  });
});
