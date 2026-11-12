import { describe, expect, it, vi } from "vitest";
import { act, screen, fireEvent } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { I18nProvider } from "@/lib/i18n/provider";
import { PasswordSignUpForm } from "./sign-up-form";
import { ar } from "@/lib/i18n/messages/ar";
import { en } from "@/lib/i18n/messages/en";
import { CHOICES_BY_KEY, REGISTRATION_CHOICE_ORDER } from "@/lib/onboarding/account-types";

vi.mock("@/server/actions/auth-password-preview", () => ({
  resendPasswordSignUpCode: vi.fn(),
  verifyPasswordSignUp: vi.fn(),
  continueToSignIn: vi.fn(),
  forgetPendingRegistration: vi.fn(),
}));
vi.mock("@/server/actions/sign-up", () => ({ requestSignUp: vi.fn(), resendPhoneSignUpCode: vi.fn(), verifyPhoneSignUp: vi.fn() }));
vi.mock("@/server/actions/entry-oauth", () => ({ startEntryOAuth: vi.fn() }));

import { requestSignUp } from "@/server/actions/sign-up";

describe("PasswordSignUpForm (Instagram style)", () => {
  it("asks for mobile number or email, password, full name, and account type, in that order", () => {
    renderWithI18n(<PasswordSignUpForm />, "en");
    const contact = screen.getByLabelText(en.authPasswordPreview.signUp.contactLabel) as HTMLInputElement;
    expect(contact.placeholder).toBe("Mobile number or email");
    expect(contact.autocomplete).toBe("username");
    const form = contact.closest("form")!;
    const order = Array.from(form.querySelectorAll("input:not([type=hidden]), select")).map((el) => (el as HTMLInputElement).name);
    expect(order).toEqual(["contact", "password", "displayName", "accountType"]);
    // No birth date and no username are collected any more.
    expect(form.querySelector('[name="birthDate"], [name="username"]')).toBeNull();
    expect((screen.getByLabelText(en.authPasswordPreview.passwordLabel) as HTMLInputElement).autocomplete).toBe("new-password");
    expect(form.querySelector('input[type=hidden][name="captchaToken"]')).not.toBeNull();
  });

  it("has no confirm-password, password-rule list or consent or age checkboxes, only the agreement line", () => {
    renderWithI18n(<PasswordSignUpForm />, "en");
    expect(document.querySelector("input[name='confirmPassword']")).toBeNull();
    expect(document.querySelectorAll("input[type='checkbox']")).toHaveLength(0);
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

  it("has no age confirmation checkbox and a plain submit is not blocked locally", async () => {
    renderWithI18n(<PasswordSignUpForm />, "en");
    expect(document.querySelector('input[name="ageConfirmed"]')).toBeNull();
    expect(screen.queryByText(/18 or older/i)).toBeNull();
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

  it.each([
    ["authPasswordPreview.error.accountExists", "person@example.test", en.authPasswordPreview.error.accountExists],
    ["authPasswordPreview.error.phoneExists", "01012345678", en.authPasswordPreview.error.phoneExists],
  ])("%s: warns under the field and offers 'Log in instead' carrying what was typed", async (code, contact, message) => {
    vi.mocked(requestSignUp).mockResolvedValueOnce({ ok: false, code, email: contact, channel: contact.includes("@") ? "email" : "phone" });
    renderWithI18n(<PasswordSignUpForm />, "en");
    fireEvent.change(screen.getByLabelText(en.authPasswordPreview.signUp.contactLabel), { target: { value: contact } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: en.authPasswordPreview.signUp.submit }));
    });
    const warning = await screen.findByText(message);
    expect(warning.closest("[data-existing-account]")).not.toBeNull();
    // The button belongs to a separate hand-off form (no nested <form>), which carries only what was typed.
    const button = screen.getByRole("button", { name: en.authPasswordPreview.error.existingAccountSignIn });
    expect(button).toHaveAttribute("type", "submit");
    const handoff = document.getElementById(button.getAttribute("form")!) as HTMLFormElement;
    expect(handoff.closest("form form")).toBeNull();
    expect(handoff.contains(document.querySelector('input[name="password"]'))).toBe(false);
    expect((handoff.querySelector('input[name="contact"]') as HTMLInputElement).value).toBe(contact);
    expect(document.querySelectorAll("form form").length).toBe(0);
    // The form stays on its details step: no code step, so nobody waits for a code.
    expect(document.querySelector('[data-sign-up-step="details"]')).not.toBeNull();
    expect(document.querySelector('[data-sign-up-step$="-code"]')).toBeNull();
  });

  it("has no \"continue registration\" link or notice anywhere", () => {
    renderWithI18n(<PasswordSignUpForm />, "en");
    expect(document.querySelector('a[href="/auth/continue-registration"]')).toBeNull();
    expect(screen.queryByText(/continue registration|finish signing up/i)).toBeNull();
  });

  it("reopens the email code step for an unfinished registration, with no password field and a way to start clean", () => {
    renderWithI18n(<PasswordSignUpForm pendingEmail="person@example.test" />, "en");
    const step = document.querySelector('[data-sign-up-step="email-code"]')!;
    expect(step).not.toBeNull();
    expect((step.querySelector('input[name="email"]') as HTMLInputElement).value).toBe("person@example.test");
    expect(document.querySelector('input[type="password"], input[name="password"]')).toBeNull();
    expect(screen.getByRole("button", { name: en.authPasswordPreview.changeEmail })).toHaveAttribute("type", "submit");
    expect(document.querySelector('[data-sign-up-step="details"]')).toBeNull();
  });

  it("a cookie that appears AFTER load (this form's own sign-up) never brings an older code step back when a replacement submission fails", async () => {
    vi.mocked(requestSignUp).mockResolvedValueOnce({ ok: false, code: "authPasswordPreview.error.accountExists", email: "taken@example.test", channel: "email" });
    const { rerender } = renderWithI18n(<PasswordSignUpForm pendingEmail={null} />, "en");
    fireEvent.change(screen.getByLabelText(en.authPasswordPreview.signUp.contactLabel), { target: { value: "taken@example.test" } });
    // The server action set a new reg_email and Next re-rendered the page with it.
    rerender(
      <I18nProvider locale="en" dir="ltr">
        <PasswordSignUpForm pendingEmail="first@example.test" />
      </I18nProvider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: en.authPasswordPreview.signUp.submit }));
    });
    expect(document.querySelector('[data-sign-up-step="email-code"]')).toBeNull();
    expect(await screen.findByText(en.authPasswordPreview.error.accountExists)).toBeInTheDocument();
  });

  it("shows the plain details form when there is no unfinished registration", () => {
    renderWithI18n(<PasswordSignUpForm pendingEmail={null} />, "en");
    expect(document.querySelector('[data-sign-up-step="details"]')).not.toBeNull();
    expect(document.querySelector('[data-sign-up-step="email-code"]')).toBeNull();
  });

  it("is fully localized in English with no Arabic leakage", () => {
    renderWithI18n(<PasswordSignUpForm />, "en");
    expect(document.body.textContent).not.toMatch(/[؀-ۿ]/);
    expect(document.body.textContent).not.toMatch(/preview|security review|not the live/i);
  });
});
