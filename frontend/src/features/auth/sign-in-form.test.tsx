import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { SignInForm } from "./sign-in-form";
import { ar } from "@/lib/i18n/messages/ar";

// The form binds to server actions; stub them so the component renders in jsdom.
vi.mock("@/server/actions/auth", () => ({
  requestEmailOtp: vi.fn(),
  verifyEmailOtp: vi.fn(),
}));

describe("SignInForm (Arabic-first passwordless)", () => {
  it("renders the Arabic email step with the passwordless hint", () => {
    renderWithI18n(<SignInForm next="/b2b" />);
    expect(screen.getByText(ar.auth.title)).toBeInTheDocument();
    expect(screen.getByLabelText(ar.auth.emailLabel)).toBeInTheDocument();
    // A submit button to request the one-time code.
    expect(screen.getByRole("button", { name: ar.auth.sendCode })).toBeInTheDocument();
    expect(screen.getByText(ar.auth.passwordless)).toBeInTheDocument();
  });

  it("marks the email input as type=email with the correct autocomplete", () => {
    renderWithI18n(<SignInForm next="/b2b" />);
    const input = screen.getByLabelText(ar.auth.emailLabel) as HTMLInputElement;
    expect(input.type).toBe("email");
    expect(input.autocomplete).toBe("email");
  });
});
