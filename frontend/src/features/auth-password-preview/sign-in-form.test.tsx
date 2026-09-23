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
      "/preview/auth-password/sign-up",
    );
    expect(screen.getByRole("link", { name: ar.authPasswordPreview.signIn.forgotPassword })).toHaveAttribute(
      "href",
      "/preview/auth-password/forgot-password",
    );
  });
});
