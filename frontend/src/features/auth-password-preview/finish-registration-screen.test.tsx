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

  it("asks for the 18+ confirmation (ageConfirmed) and has no username or birth-date field", () => {
    const { container } = renderWithI18n(<FinishRegistrationScreen />, "en");
    const box = screen.getByRole("checkbox", { name: "I confirm I am 18 or older" });
    expect(box).toHaveAttribute("name", "ageConfirmed");
    expect(box).toHaveAttribute("aria-required", "true");
    expect(container.querySelector('input[name="username"], select[name="birthYear"]')).toBeNull();
  });

  it("renders the 18+ confirmation in Arabic", () => {
    renderWithI18n(<FinishRegistrationScreen />, "ar");
    expect(screen.getByRole("checkbox", { name: "أقرّ بأن عمري ١٨ عامًا أو أكثر" })).toBeTruthy();
  });
});
