import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { PasswordSignUpForm } from "./sign-up-form";
import { ar } from "@/lib/i18n/messages/ar";
import { en } from "@/lib/i18n/messages/en";
import { CHOICES_BY_KEY, REGISTRATION_CHOICE_ORDER } from "@/lib/onboarding/account-types";

vi.mock("@/server/actions/auth-password-preview", () => ({
  resendPasswordSignUpCode: vi.fn(),
  verifyPasswordSignUp: vi.fn(),
}));
vi.mock("@/server/actions/sign-up", () => ({ requestSignUp: vi.fn(), resendPhoneSignUpCode: vi.fn(), verifyPhoneSignUp: vi.fn() }));
vi.mock("@/server/actions/entry-oauth", () => ({ startEntryOAuth: vi.fn() }));

describe("PasswordSignUpForm (Instagram style)", () => {
  it("asks for mobile number or email, password, birthday, full name, username and account type, in that order", () => {
    renderWithI18n(<PasswordSignUpForm />, "en");
    const contact = screen.getByLabelText(en.authPasswordPreview.signUp.contactLabel) as HTMLInputElement;
    expect(contact.placeholder).toBe("Mobile number or email");
    expect(contact.autocomplete).toBe("username");
    const form = contact.closest("form")!;
    const order = Array.from(form.querySelectorAll("input:not([type=hidden]), select")).map((el) => (el as HTMLInputElement).name);
    expect(order).toEqual(["contact", "password", "", "", "", "displayName", "username", "accountType"]);
    expect(form.querySelector('input[type=hidden][name="birthDate"]')).not.toBeNull();
    expect((screen.getByLabelText(en.authPasswordPreview.passwordLabel) as HTMLInputElement).autocomplete).toBe("new-password");
    expect(form.querySelector('input[type=hidden][name="captchaToken"]')).not.toBeNull();
  });

  it("has no confirm-password, password-rule list or consent checkboxes, only the agreement line", () => {
    renderWithI18n(<PasswordSignUpForm />, "en");
    expect(document.querySelector("input[name='confirmPassword']")).toBeNull();
    expect(document.querySelector("input[type='checkbox']")).toBeNull();
    expect(document.body.textContent).not.toContain(en.authPasswordPreview.consent.note);
    const agreement = document.querySelector("[data-sign-up-agreement]")!;
    expect(agreement.textContent).toContain(en.authPasswordPreview.signUp.agreementPrefix);
    expect(screen.getByRole("link", { name: en.entryAuth.terms })).toHaveAttribute("href", "/legal/terms");
    expect(screen.getByRole("link", { name: en.entryAuth.privacy })).toHaveAttribute("href", "/legal/privacy");
    // The three consents are still submitted for the server to record.
    for (const type of ["terms", "privacy", "pilot"]) {
      expect((document.querySelector(`input[type=hidden][name="consent_${type}"]`) as HTMLInputElement).value).toBe("on");
    }
  });

  it("takes the birthday as Month / Day / Year dropdowns, 18+ years only, and submits one YYYY-MM-DD value", () => {
    renderWithI18n(<PasswordSignUpForm />, "en");
    const month = screen.getByLabelText(en.authPasswordPreview.signUp.birthMonth) as HTMLSelectElement;
    const day = screen.getByLabelText(en.authPasswordPreview.signUp.birthDay) as HTMLSelectElement;
    const year = screen.getByLabelText(en.authPasswordPreview.signUp.birthYear) as HTMLSelectElement;
    for (const select of [month, day, year]) expect(select.required).toBe(true);
    expect(month.options[1]!.textContent).toBe("January");
    expect(Number(year.options[1]!.value)).toBe(new Date().getFullYear() - 18);
    const hidden = document.querySelector('input[type=hidden][name="birthDate"]') as HTMLInputElement;
    expect(hidden.value).toBe("");
    fireEvent.change(month, { target: { value: "2" } });
    expect(day.options).toHaveLength(1 + 29);
    fireEvent.change(day, { target: { value: "9" } });
    fireEvent.change(year, { target: { value: "1990" } });
    expect(hidden.value).toBe("1990-02-09");
    expect(day.options).toHaveLength(1 + 28);
    expect(screen.getByText(en.authPasswordPreview.signUp.birthDateHint)).toBeInTheDocument();
  });

  it("enables submit without ticking anything", () => {
    renderWithI18n(<PasswordSignUpForm />);
    const submit = screen.getByRole("button", { name: ar.authPasswordPreview.signUp.submit }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
  });

  it("has no nested <form> at step 1", () => {
    renderWithI18n(<PasswordSignUpForm />);
    expect(document.querySelectorAll("form form").length).toBe(0);
  });

  it("offers account types in ONE dropdown: placeholder first, active types selectable, Coming Soon visible but disabled", () => {
    renderWithI18n(<PasswordSignUpForm />);
    const select = screen.getByLabelText(ar.authPasswordPreview.accountTypeLabel) as HTMLSelectElement;
    expect(select.name).toBe("accountType");
    const options = Array.from(select.options);
    expect(options[0]!.value).toBe("");
    expect(options[0]!.disabled).toBe(true);
    expect(options.slice(1).map((o) => o.value)).toEqual(REGISTRATION_CHOICE_ORDER);
    for (const option of options.slice(1)) {
      expect(option.disabled, option.value).toBe(CHOICES_BY_KEY[option.value]!.comingSoon === true);
    }
    fireEvent.change(select, { target: { value: "installer_technician" } });
    expect(select.value).toBe("installer_technician");
  });

  it("hides the dropdown and shows a badge when the landing page chose the type", () => {
    renderWithI18n(<PasswordSignUpForm initialAccountType="supplier" />, "en");
    expect(document.querySelector("select[name='accountType']")).toBeNull();
    expect((document.querySelector("input[type=hidden][name='accountType']") as HTMLInputElement).value).toBe("supplier");
    expect(screen.getByText(new RegExp(en.authPasswordPreview.accountTypeLocked))).toBeInTheDocument();
  });

  it("puts Google and Facebook first, above an OR rule, when Supabase has them on", () => {
    renderWithI18n(<PasswordSignUpForm providers={{ google: true, facebook: false }} initialAccountType="supplier" />, "en");
    const google = screen.getByRole("button", { name: en.entryAuth.continueWithGoogle });
    expect(screen.queryByRole("button", { name: en.entryAuth.continueWithFacebook })).toBeNull();
    expect((google.closest("form")!.querySelector("input[name='accountType']") as HTMLInputElement).value).toBe("supplier");
    const separator = screen.getByRole("separator");
    expect(google.compareDocumentPosition(separator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is fully localized in English with no Arabic leakage", () => {
    renderWithI18n(<PasswordSignUpForm />, "en");
    expect(document.body.textContent).not.toMatch(/[؀-ۿ]/);
    expect(document.body.textContent).not.toMatch(/preview|security review|not the live/i);
  });
});
