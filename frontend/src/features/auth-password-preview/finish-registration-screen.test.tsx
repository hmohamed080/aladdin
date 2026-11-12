import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";

vi.mock("@/server/actions/registration", () => ({
  chooseAccountTypeAction: vi.fn(async () => ({ ok: false })),
}));

import { FinishRegistrationScreen } from "./finish-registration-screen";

describe("FinishRegistrationScreen", () => {
  it("asks for the account type (shared Select over a hidden native select named accountType)", () => {
    renderWithI18n(<FinishRegistrationScreen />, "en");
    expect(screen.getByRole("button", { name: /account type/i })).toHaveAttribute("aria-haspopup", "listbox");
    expect(document.querySelector('select[name="accountType"]')).not.toBeNull();
  });

  it("has no age checkbox, username or birth-date field", () => {
    const { container } = renderWithI18n(<FinishRegistrationScreen />, "en");
    expect(container.querySelector('input[name="ageConfirmed"], input[type="checkbox"]')).toBeNull();
    expect(container.querySelector('input[name="username"], select[name="birthYear"]')).toBeNull();
  });
});
