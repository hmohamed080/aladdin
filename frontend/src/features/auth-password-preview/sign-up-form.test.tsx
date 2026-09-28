import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { PasswordSignUpForm } from "./sign-up-form";
import { ar } from "@/lib/i18n/messages/ar";
import { en } from "@/lib/i18n/messages/en";
import { CHOICES_BY_KEY, REGISTRATION_CHOICE_ORDER } from "@/lib/onboarding/account-types";

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

  it("renders Full Name FIRST, then email, username, the account-type dropdown, password + confirm, and the CAPTCHA slot", () => {
    renderWithI18n(<PasswordSignUpForm />);
    const name = screen.getByLabelText(ar.authPasswordPreview.fullNameLabel) as HTMLInputElement;
    expect(name.name).toBe("displayName");
    expect(name.placeholder).toBe(ar.authPasswordPreview.fullNamePlaceholder);
    expect(name.autocomplete).toBe("name");
    expect(name.required).toBe(true);
    expect(name.maxLength).toBe(80);

    const form = name.closest("form")!;
    const order = Array.from(form.querySelectorAll("input:not([type=hidden]):not([type=checkbox]), select")).map(
      (el) => (el as HTMLInputElement).name,
    );
    expect(order).toEqual(["displayName", "email", "username", "accountType", "password", "confirmPassword"]);
    expect(form.querySelector('input[type=hidden][name="captchaToken"]')).not.toBeNull();
  });

  it("offers account types in ONE dropdown: placeholder first, active types selectable, Coming Soon visible but disabled", () => {
    renderWithI18n(<PasswordSignUpForm />);
    const select = screen.getByLabelText(ar.authPasswordPreview.accountTypeLabel) as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(select.name).toBe("accountType");
    expect(select.value).toBe("");

    const options = Array.from(select.options);
    expect(options[0]!.value).toBe("");
    expect(options[0]!.textContent).toBe("اختر نوع الحساب");
    expect(options[0]!.disabled).toBe(true);
    expect(options.slice(1).map((o) => o.value)).toEqual(REGISTRATION_CHOICE_ORDER);

    for (const option of options.slice(1)) {
      const choice = CHOICES_BY_KEY[option.value]!;
      const typeLabel = (ar.onboarding.accountType.types as Record<string, string>)[option.value]!;
      if (choice.comingSoon) {
        expect(option.disabled, option.value).toBe(true);
        expect(option.textContent).toBe(`${typeLabel} — قريبًا`);
      } else {
        expect(option.disabled, option.value).toBe(false);
        expect(option.textContent).toBe(typeLabel);
      }
    }
    expect(options.find((o) => o.value === "contractor")!.textContent).toBe("المقاول — قريبًا");

    fireEvent.change(select, { target: { value: "installer_technician" } });
    expect(select.value).toBe("installer_technician");
    expect(screen.getByText(ar.onboarding.accountType.types.installer_technicianDesc)).toBeInTheDocument();
  });

  it("is fully localized in English with no Arabic leakage in the new fields", () => {
    renderWithI18n(<PasswordSignUpForm />, "en");
    const name = screen.getByLabelText("Full name") as HTMLInputElement;
    expect(name.placeholder).toBe("Enter your full name");
    const select = screen.getByLabelText(en.authPasswordPreview.accountTypeLabel) as HTMLSelectElement;
    const texts = Array.from(select.options).map((o) => o.textContent ?? "");
    expect(texts[0]).toBe("Choose an account type");
    expect(texts.find((t) => t.startsWith(en.onboarding.accountType.types.contractor))).toBe(
      `${en.onboarding.accountType.types.contractor} — Coming soon`,
    );
    for (const text of texts) expect(text).not.toMatch(/[\u0600-\u06FF]/);
  });

  it("never shows preview/security-review wording", () => {
    renderWithI18n(<PasswordSignUpForm />, "en");
    expect(document.body.textContent).not.toMatch(/preview|security review|not the live/i);
  });
});
