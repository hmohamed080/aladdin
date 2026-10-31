import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { ContinueRegistrationForm } from "./continue-registration-form";
import { en } from "@/lib/i18n/messages/en";

vi.mock("@/server/actions/auth-password-preview", () => ({
  resendPasswordSignUpCode: vi.fn(),
  verifyPasswordSignUp: vi.fn(),
  forgetPendingRegistration: vi.fn(),
}));

const copy = en.authPasswordPreview.continueRegistration;

describe("ContinueRegistrationForm", () => {
  it("without an unfinished registration in this browser: asks only for the email (plus CAPTCHA), never a password", () => {
    renderWithI18n(<ContinueRegistrationForm pendingEmail={null} />, "en");
    expect(screen.getByRole("heading", { name: copy.title })).toBeInTheDocument();
    expect((screen.getByLabelText(copy.emailLabel) as HTMLInputElement).type).toBe("email");
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(document.querySelector('[data-continue-step="email"]')).not.toBeNull();
  });

  it("with an unfinished registration: opens on the code step, shows the email masked, no password field, no email field", () => {
    renderWithI18n(<ContinueRegistrationForm pendingEmail="person@example.test" />, "en");
    expect(document.querySelector('[data-continue-step="code"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("person@example.test");
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(document.querySelector('input[name="email"]')).toBeNull();
    expect(screen.getByText(copy.passwordNote, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: en.authPasswordPreview.signIn.forgotPassword })).toHaveAttribute("href", "/auth/forgot-password");
    expect(screen.getByRole("button", { name: copy.useAnotherEmail })).toBeInTheDocument();
    // Arriving from the cookie sends nothing, so the copy must not claim a new code was sent.
    expect(document.body.textContent).not.toMatch(/we've sent a new/i);
  });

  it("has no nested <form>", () => {
    renderWithI18n(<ContinueRegistrationForm pendingEmail="person@example.test" />, "en");
    expect(document.querySelectorAll("form form").length).toBe(0);
  });
});
