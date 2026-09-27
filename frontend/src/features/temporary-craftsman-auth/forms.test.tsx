import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { ar } from "@/lib/i18n/messages/ar";
import { CraftsmanSignUpForm } from "./sign-up-form";
import { CraftsmanSignInForm } from "./sign-in-form";

const { craftsmanSignUp, craftsmanSignIn } = vi.hoisted(() => ({
  craftsmanSignUp: vi.fn(async () => ({ ok: false })),
  craftsmanSignIn: vi.fn(async () => ({ ok: false })),
}));
vi.mock("@/server/actions/temporary-craftsman-auth", () => ({ craftsmanSignUp, craftsmanSignIn }));
// Turnstile loads a third-party script; not under test here.
vi.mock("@/features/auth-password-preview/turnstile-widget", () => ({ TurnstileWidget: () => null }));

const c = ar.temporaryCraftsman;

describe("CraftsmanSignUpForm", () => {
  it("asks ONLY for name, phone, password and consent — no email, OTP, username or role", () => {
    renderWithI18n(<CraftsmanSignUpForm />);
    const inputs = Array.from(document.querySelectorAll("input")).map((i) => i.name).filter(Boolean);
    expect(inputs.sort()).toEqual(["consent", "name", "password", "phone"]);
    expect(screen.getByLabelText(c.fields.nameLabel)).toHaveAttribute("autocomplete", "name");
    expect(screen.getByLabelText(c.fields.phoneLabel)).toHaveAttribute("type", "tel");
    expect(screen.getByLabelText(c.fields.passwordLabel)).toHaveAttribute("autocomplete", "new-password");
    expect(document.querySelector('input[type="email"]')).toBeNull();
  });

  it("shows the project's 10-character hint, not the mockup's 6", () => {
    renderWithI18n(<CraftsmanSignUpForm />);
    expect(screen.getByText(c.fields.passwordHint)).toBeInTheDocument();
    expect(c.fields.passwordHint).toContain("١٠");
  });

  it("shows Arabic validation messages and never submits an invalid form", () => {
    renderWithI18n(<CraftsmanSignUpForm />);
    fireEvent.submit(screen.getByRole("button", { name: c.signUp.submit }).closest("form")!);
    expect(screen.getByText(c.error.nameRequired)).toBeInTheDocument();
    expect(screen.getByText(c.error.phoneInvalid)).toBeInTheDocument();
    expect(screen.getByText(c.error.passwordTooShort)).toBeInTheDocument();
    expect(screen.getByText(c.error.consentRequired)).toBeInTheDocument();
    expect(craftsmanSignUp).not.toHaveBeenCalled();
  });

  it("links the consent to the real legal pages", () => {
    renderWithI18n(<CraftsmanSignUpForm />);
    expect(screen.getByRole("link", { name: c.signUp.termsLink })).toHaveAttribute("href", "/legal/terms");
    expect(screen.getByRole("link", { name: c.signUp.privacyLink })).toHaveAttribute("href", "/legal/privacy");
  });
});

describe("CraftsmanSignInForm", () => {
  it("asks only for phone + password and has no forgot-password link", () => {
    renderWithI18n(<CraftsmanSignInForm />);
    const inputs = Array.from(document.querySelectorAll("input")).map((i) => i.name).filter(Boolean);
    expect(inputs.sort()).toEqual(["password", "phone"]);
    expect(screen.getByLabelText(c.fields.passwordLabel)).toHaveAttribute("autocomplete", "current-password");
    expect(screen.queryByText(ar.authPasswordPreview.signIn.forgotPassword)).toBeNull();
    expect(document.querySelectorAll("a")).toHaveLength(0);
  });

  it("toggles password visibility with an accessible button", () => {
    renderWithI18n(<CraftsmanSignInForm />);
    const password = screen.getByLabelText(c.fields.passwordLabel);
    expect(password).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: ar.authPasswordPreview.showPassword }));
    expect(password).toHaveAttribute("type", "text");
  });

  it("validates the phone before submitting", () => {
    renderWithI18n(<CraftsmanSignInForm />);
    fireEvent.change(screen.getByLabelText(c.fields.phoneLabel), { target: { value: "12" } });
    fireEvent.submit(screen.getByRole("button", { name: c.signIn.submit }).closest("form")!);
    expect(screen.getByText(c.error.phoneInvalid)).toBeInTheDocument();
    expect(screen.getByText(c.error.passwordRequired)).toBeInTheDocument();
    expect(craftsmanSignIn).not.toHaveBeenCalled();
  });
});
