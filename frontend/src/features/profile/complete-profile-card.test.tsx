import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { CompleteProfileCard } from "./complete-profile-card";

describe("CompleteProfileCard", () => {
  it("shows the authoritative percentage and one link per missing item", () => {
    renderWithI18n(
      <CompleteProfileCard completion={{ percent: 40, missing: ["avatar", "phone", "display_name"] }} />,
      "en",
    );
    expect(screen.getByText("Complete your profile")).toBeTruthy();
    expect(screen.getByTestId("complete-profile-percent").textContent).toBe("40% complete");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("40");
    expect(screen.getByRole("link", { name: "Add a profile photo" }).getAttribute("href")).toBe("/home/settings#identity");
    expect(screen.getByRole("link", { name: "Add your phone number" }).getAttribute("href")).toBe("/home/settings#phone");
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
});
