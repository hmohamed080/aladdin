import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { PasswordSignInForm } from "./sign-in-form";
import { ar } from "@/lib/i18n/messages/ar";

vi.mock("@/server/actions/auth-password-preview", () => ({
  passwordSignIn: vi.fn(),
}));

describe("PasswordSignInForm", () => {
  it("renders email + password with password-manager-friendly autocomplete", () => {
    renderWithI18n(<PasswordSignInForm next="/b2b" />);
    const email = screen.getByLabelText(ar.authPasswordPreview.emailLabel) as HTMLInputElement;
    const password = screen.getByLabelText(ar.authPasswordPreview.passwordLabel) as HTMLInputElement;
    expect(email.type).toBe("email");
    expect(email.autocomplete).toBe("email");
    expect(password.autocomplete).toBe("current-password");
  });

  it("has no nested <form> (valid HTML, single submit)", () => {
    renderWithI18n(<PasswordSignInForm next="/b2b" />);
    expect(document.querySelectorAll("form form").length).toBe(0);
    expect(screen.getAllByRole("button", { name: ar.authPasswordPreview.signIn.submit }).length).toBe(1);
  });

  it("links to both Sign Up and Forgot Password", () => {
    renderWithI18n(<PasswordSignInForm next="/b2b" />);
    expect(screen.getByRole("link", { name: ar.authPasswordPreview.signIn.signUpLink })).toHaveAttribute(
      "href",
      "/auth/sign-up",
    );
    expect(screen.getByRole("link", { name: ar.authPasswordPreview.signIn.forgotPassword })).toHaveAttribute(
      "href",
      "/auth/forgot-password",
    );
  });

  it("offers the installer phone sign-in link in Arabic, defaulting to /installer/sign-in", () => {
    renderWithI18n(<PasswordSignInForm next="/b2b" />);
    const link = screen.getByRole("link", { name: "صنايعي؟ سجل الدخول برقم الهاتف" });
    expect(link).toHaveAttribute("href", "/installer/sign-in");
  });

  it("offers the installer phone sign-in link in English", () => {
    renderWithI18n(<PasswordSignInForm next="/b2b" />, "en");
    const link = screen.getByRole("link", { name: "Craftsman? Sign in with your phone number" });
    expect(link).toHaveAttribute("href", "/installer/sign-in");
  });

  it("uses the href the page validated for the installer link", () => {
    renderWithI18n(<PasswordSignInForm next="/home/points" installerSignInHref="/installer/sign-in?next=%2Fhome%2Fpoints" />);
    expect(screen.getByRole("link", { name: ar.auth.installerPhoneSignIn })).toHaveAttribute(
      "href",
      "/installer/sign-in?next=%2Fhome%2Fpoints",
    );
  });
});
