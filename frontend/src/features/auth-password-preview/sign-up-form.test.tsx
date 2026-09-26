import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { PasswordSignUpForm } from "./sign-up-form";
import { ar } from "@/lib/i18n/messages/ar";

vi.mock("@/server/actions/auth-password-preview", () => ({
  requestPasswordSignUp: vi.fn(),
  resendPasswordSignUpCode: vi.fn(),
  verifyPasswordSignUp: vi.fn(),
}));

describe("PasswordSignUpForm", () => {
  it("renders email + password + confirm-password with password-manager-friendly autocomplete", () => {
    renderWithI18n(<PasswordSignUpForm />);
    const email = screen.getByLabelText(ar.authPasswordPreview.emailLabel) as HTMLInputElement;
    const password = screen.getByLabelText(ar.authPasswordPreview.passwordLabel) as HTMLInputElement;
    const confirm = screen.getByLabelText(ar.authPasswordPreview.confirmPasswordLabel) as HTMLInputElement;
    expect(email.autocomplete).toBe("email");
    expect(password.autocomplete).toBe("new-password");
    expect(confirm.autocomplete).toBe("new-password");
  });

  it("has no nested <form> at step 1", () => {
    renderWithI18n(<PasswordSignUpForm />);
    expect(document.querySelectorAll("form form").length).toBe(0);
  });

  it("disables submit until all three consents are checked", () => {
    renderWithI18n(<PasswordSignUpForm />);
    const submit = screen.getByRole("button", { name: ar.authPasswordPreview.signUp.submit }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText(ar.authPasswordPreview.consent.terms));
    fireEvent.click(screen.getByLabelText(ar.authPasswordPreview.consent.privacy));
    expect(submit.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText(ar.authPasswordPreview.consent.pilot));
    expect(submit.disabled).toBe(false);
  });

  it("shows a mismatch error and disables submit when confirm-password differs", () => {
    renderWithI18n(<PasswordSignUpForm />);
    const password = screen.getByLabelText(ar.authPasswordPreview.passwordLabel);
    const confirm = screen.getByLabelText(ar.authPasswordPreview.confirmPasswordLabel);
    fireEvent.change(password, { target: { value: "a-long-enough-passphrase" } });
    fireEvent.change(confirm, { target: { value: "a-different-passphrase-x" } });

    expect(screen.getByText(ar.authPasswordPreview.error.passwordMismatch)).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: ar.authPasswordPreview.signUp.submit }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("shows the live length requirement hint", () => {
    renderWithI18n(<PasswordSignUpForm />);
    const password = screen.getByLabelText(ar.authPasswordPreview.passwordLabel);
    fireEvent.change(password, { target: { value: "short" } });
    expect(screen.getByText(/١٠|10/)).toBeInTheDocument();
  });
});
