import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { PasswordSignInForm } from "./sign-in-form";
import { ar } from "@/lib/i18n/messages/ar";
import { en } from "@/lib/i18n/messages/en";

vi.mock("@/server/actions/auth-password-preview", () => ({
  passwordSignIn: vi.fn(),
}));
vi.mock("@/server/actions/entry-oauth", () => ({ startEntryOAuth: vi.fn() }));

describe("PasswordSignInForm", () => {
  it("renders ONE mobile / username / email field and the password, password-manager friendly", () => {
    renderWithI18n(<PasswordSignInForm next="/b2b" />, "en");
    const identifier = screen.getByLabelText(en.authPasswordPreview.signIn.identifierLabel) as HTMLInputElement;
    const password = screen.getByLabelText(en.authPasswordPreview.passwordLabel) as HTMLInputElement;
    expect(identifier.name).toBe("identifier");
    expect(identifier.type).toBe("text");
    expect(identifier.autocomplete).toBe("username");
    expect(identifier.placeholder).toBe("Mobile number, username or email");
    expect(password.autocomplete).toBe("current-password");
  });

  it("has no nested <form> (valid HTML, single submit)", () => {
    renderWithI18n(<PasswordSignInForm next="/b2b" />);
    expect(document.querySelectorAll("form form").length).toBe(0);
    expect(screen.getAllByRole("button", { name: ar.authPasswordPreview.signIn.submit }).length).toBe(1);
  });

  it("links to Sign Up and Forgot Password, and no longer to separate phone sign-in pages", () => {
    renderWithI18n(<PasswordSignInForm next="/b2b" />);
    expect(screen.getByRole("link", { name: ar.authPasswordPreview.signIn.signUpLink })).toHaveAttribute("href", "/auth/sign-up");
    expect(screen.getByRole("link", { name: ar.authPasswordPreview.signIn.forgotPassword })).toHaveAttribute("href", "/auth/forgot-password");
    const hrefs = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs.some((href) => /\/(installer|showroom)\/sign-in/.test(href ?? ""))).toBe(false);
  });

  it("shows Google and Facebook under an OR rule only when Supabase has them on", () => {
    const { unmount } = renderWithI18n(<PasswordSignInForm next="/b2b" />, "en");
    expect(screen.queryByRole("button", { name: en.entryAuth.continueWithGoogle })).toBeNull();
    expect(screen.queryByRole("separator")).toBeNull();
    unmount();
    renderWithI18n(<PasswordSignInForm next="/b2b" providers={{ google: true, facebook: true }} />, "en");
    expect(screen.getByRole("button", { name: en.entryAuth.continueWithGoogle })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.entryAuth.continueWithFacebook })).toBeInTheDocument();
    expect(screen.getByRole("separator")).toHaveTextContent("OR");
  });

  it("explains a failed Google/Facebook round trip", () => {
    renderWithI18n(<PasswordSignInForm next="/b2b" oauthError="oauth_email" />, "en");
    expect(screen.getByRole("alert")).toHaveTextContent(en.entryAuth.error.oauthEmail);
  });
});
