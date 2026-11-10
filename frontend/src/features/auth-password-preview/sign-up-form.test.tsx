import { describe, expect, it, vi } from "vitest";
import { act, screen, fireEvent } from "@testing-library/react";
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

import { requestSignUp } from "@/server/actions/sign-up";

describe("PasswordSignUpForm (Instagram style)", () => {
  it("asks for mobile number or email, password, full name, account type and the 18+ confirmation, in that order", () => {
    renderWithI18n(<PasswordSignUpForm />, "en");
    const contact = screen.getByLabelText(en.authPasswordPreview.signUp.contactLabel) as HTMLInputElement;
    expect(contact.placeholder).toBe("Mobile number or email");
    expect(contact.autocomplete).toBe("username");
    const form = contact.closest("form")!;
    const order = Array.from(form.querySelectorAll("input:not([type=hidden]), select")).map((el) => (el as HTMLInputElement).name);
    expect(order).toEqual(["contact", "password", "displayName", "accountType", "ageConfirmed"]);
    // No birth date and no username are collected any more.
    expect(form.querySelector('[name="birthDate"], [name="username"]')).toBeNull();
    expect((screen.getByLabelText(en.authPasswordPreview.passwordLabel) as HTMLInputElement).autocomplete).toBe("new-password");
    expect(form.querySelector('input[type=hidden][name="captchaToken"]')).not.toBeNull();
  });

  it("has no confirm-password, password-rule list or consent checkboxes (only the 18+ confirmation), only the agreement line", () => {
    renderWithI18n(<PasswordSignUpForm />, "en");
    expect(document.querySelector("input[name='confirmPassword']")).toBeNull();
    expect([...document.querySelectorAll("input[type='checkbox']")].map((el) => (el as HTMLInputElement).name)).toEqual(["ageConfirmed"]);
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

  it("asks for a required 18+ confirmation (ageConfirmed=true) with an accessible error instead of a birthday", async () => {
    renderWithI18n(<PasswordSignUpForm />, "en");
    const box = screen.getByRole("checkbox", { name: en.authPasswordPreview.signUp.ageConfirmLabel }) as HTMLInputElement;
    expect(box.name).toBe("ageConfirmed");
    expect(box.value).toBe("true");
    expect(box.checked).toBe(false);
    expect(box).toHaveAttribute("aria-required", "true");
    expect(box).not.toHaveAttribute("aria-invalid");
    // Submitting while unchecked is blocked locally and announces the error, linked to the checkbox.
    await act(async () => { fireEvent.submit(box.closest("form")!); });
    const alert = await screen.findByText(en.authPasswordPreview.error.ageNotConfirmed);
    expect(alert).toHaveAttribute("role", "alert");
    expect(requestSignUp).not.toHaveBeenCalled(); // the server action never ran
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box.getAttribute("aria-describedby")).toBe(alert.id);
    // Ticking clears it.
    fireEvent.click(box);
    expect(screen.queryByText(en.authPasswordPreview.error.ageNotConfirmed)).toBeNull();
    expect(box.checked).toBe(true);
  });

  it("shows the 18+ confirmation and its error in Arabic", async () => {
    renderWithI18n(<PasswordSignUpForm />, "ar");
    const box = screen.getByRole("checkbox", { name: ar.authPasswordPreview.signUp.ageConfirmLabel });
    await act(async () => { fireEvent.submit(box.closest("form")!); });
    expect(await screen.findByText(ar.authPasswordPreview.error.ageNotConfirmed)).toHaveAttribute("role", "alert");
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
