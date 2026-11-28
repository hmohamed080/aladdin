import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { ar } from "@/lib/i18n/messages/ar";
import { EntryAuthPanel, entryErrorKey } from "./entry-auth-panel";
import { EntryEmailSignInForm, EntryEmailSignUpForm, signUpErrorField } from "./email-forms";

vi.mock("@/server/actions/general-oauth", () => ({ startGeneralOAuth: vi.fn() }));
vi.mock("@/server/actions/entry-oauth", () => ({ startEntryOAuth: vi.fn() }));
vi.mock("@/server/actions/showroom-phone-auth", () => ({ showroomEmailSignIn: vi.fn(async () => ({ ok: false })), showroomEmailSignUp: vi.fn(async () => ({ ok: false })) }));
vi.mock("@/server/actions/installer-phone-auth", () => ({ craftsmanEmailSignIn: vi.fn(async () => ({ ok: false })), craftsmanEmailSignUp: vi.fn(async () => ({ ok: false })) }));
vi.mock("@/server/actions/auth-password-preview", () => ({ resendPasswordSignUpCode: vi.fn(), verifyPasswordSignUp: vi.fn() }));
vi.mock("@/features/auth-password-preview/turnstile-widget", () => ({ TurnstileWidget: () => null }));

const e = ar.entryAuth;
const both = { google: true, facebook: true };

describe("EntryAuthPanel", () => {
  it("offers Google, Facebook and a Phone | Email switch with phone first", () => {
    renderWithI18n(<EntryAuthPanel kind="showroom" providers={both} phone={<p>phone form</p>} email={<p>email form</p>} />);
    expect(screen.getByRole("button", { name: e.continueWithGoogle })).toHaveAttribute("value", "google");
    expect(screen.getByRole("button", { name: e.continueWithFacebook })).toHaveAttribute("value", "facebook");
    expect(document.querySelector('input[name="kind"]')).toHaveValue("showroom");
    expect(screen.getByRole("tab", { name: e.methodPhone })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("phone form")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: e.methodEmail }));
    expect(screen.getByText("email form")).toBeInTheDocument();
    expect(screen.queryByText("phone form")).toBeNull();
  });

  it("hides providers that are not switched on", () => {
    renderWithI18n(<EntryAuthPanel kind="installer" providers={{ google: true, facebook: false }} phone={null} email={null} />);
    expect(screen.getByRole("button", { name: e.continueWithGoogle })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: e.continueWithFacebook })).toBeNull();
  });

  it("renders no OAuth block at all before any provider is configured", () => {
    renderWithI18n(<EntryAuthPanel kind="installer" providers={{ google: false, facebook: false }} phone={null} email={null} />);
    expect(document.querySelector("[data-entry-oauth]")).toBeNull();
    expect(screen.queryByText(e.or)).toBeNull();
  });

  it("opens on email when asked and shows the callback's reason", () => {
    renderWithI18n(<EntryAuthPanel kind="installer" providers={both} initialMethod="email" error="wrong_account" phone={<p>phone form</p>} email={<p>email form</p>} />);
    expect(screen.getByText("email form")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(e.error.notInstallerAccount);
  });

  it("maps only known callback reasons", () => {
    expect(entryErrorKey("showroom", "wrong_account")).toBe("entryAuth.error.notShowroomAccount");
    expect(entryErrorKey("showroom", "oauth_email")).toBe("entryAuth.error.oauthEmail");
    expect(entryErrorKey("showroom", "<script>")).toBeNull();
    expect(entryErrorKey("showroom", "toString")).toBeNull();
    expect(entryErrorKey("showroom", undefined)).toBeNull();
  });
});

describe("email forms", () => {
  it.each(["showroom", "installer"] as const)("%s sign-in asks for email and password only", (kind) => {
    renderWithI18n(<EntryEmailSignInForm kind={kind} next="/b2b" />);
    const names = Array.from(document.querySelectorAll("input")).map((i) => i.name).filter(Boolean).sort();
    expect(names).toEqual(["email", "next", "password"]);
    expect(document.querySelector('input[type="email"]')).toHaveAttribute("autocomplete", "email");
  });

  it.each(["showroom", "installer"] as const)("%s sign-up asks for name, email, password, confirmation and consent", (kind) => {
    renderWithI18n(<EntryEmailSignUpForm kind={kind} />);
    const names = Array.from(document.querySelectorAll("input")).map((i) => i.name).filter(Boolean).sort();
    expect(names).toEqual(["confirmPassword", "consent", "consent-choice", "email", "name", "password"]);
  });

  it("validates before submitting", () => {
    renderWithI18n(<EntryEmailSignUpForm kind="showroom" />);
    fireEvent.submit(document.querySelector("form")!);
    expect(screen.getByText(e.error.emailInvalid)).toBeInTheDocument();
    expect(screen.getByText(ar.temporaryCraftsman.error.consentRequired)).toBeInTheDocument();
  });

  it("places canonical registration errors on the right field", () => {
    expect(signUpErrorField("authPasswordPreview.error.fullNameRequired")).toBe("name");
    expect(signUpErrorField("authPasswordPreview.error.invalidEmail")).toBe("email");
    expect(signUpErrorField("authPasswordPreview.error.passwordMismatch")).toBe("confirmPassword");
    expect(signUpErrorField("authPasswordPreview.error.passwordTooShort")).toBe("password");
    expect(signUpErrorField("authPasswordPreview.error.consentRequired")).toBe("consent");
    expect(signUpErrorField("authPasswordPreview.error.captchaRejected")).toBe("captcha");
    expect(signUpErrorField("authPasswordPreview.error.sendFailed")).toBe("form");
  });
});
