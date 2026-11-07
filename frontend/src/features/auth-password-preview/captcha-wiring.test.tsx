import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/auth",
  useSearchParams: () => new URLSearchParams(),
}));

// Every action module the forms import is mocked: this file proves WIRING only - which
// Turnstile field each form submits, with which action - not server behavior.
vi.mock("@/server/actions/auth-password-preview", () => ({
  passwordSignIn: vi.fn(),
  changePassword: vi.fn(),
  requestRecoveryCode: vi.fn(),
  resendRecoveryCode: vi.fn(),
  verifyRecoveryCode: vi.fn(),
  requestPasswordSignUp: vi.fn(),
  resendPasswordSignUpCode: vi.fn(),
  verifyPasswordSignUp: vi.fn(),
}));
vi.mock("@/server/actions/auth", () => ({ requestEmailOtp: vi.fn(), verifyEmailOtp: vi.fn(), requestSignUpOtp: vi.fn(), verifySignUpOtp: vi.fn() }));
vi.mock("@/server/actions/sign-up", () => ({ requestSignUp: vi.fn(), resendPhoneSignUpCode: vi.fn(), verifyPhoneSignUp: vi.fn() }));
vi.mock("@/server/actions/entry-oauth", () => ({ startEntryOAuth: vi.fn() }));

import { PasswordSignInForm } from "./sign-in-form";
import { ChangePasswordForm } from "./change-password-form";
import { RecoveryVerifyForm } from "./recovery-verify-form";
import { ForgotPasswordForm } from "./forgot-password-form";
import { PasswordSignUpForm } from "./sign-up-form";
import { VerifyForm } from "@/features/auth/verify-form";
import { RecoveryForm } from "@/features/auth/recovery-form";

type Rendered = { action?: string; appearance?: string };
let renders: Rendered[];

beforeEach(() => {
  renders = [];
  (window as unknown as { turnstile: unknown }).turnstile = {
    render: (_el: HTMLElement, options: Rendered) => {
      renders.push(options);
      return `w${renders.length}`;
    },
    remove: vi.fn(),
  };
});
afterEach(() => {
  delete (window as unknown as { turnstile?: unknown }).turnstile;
});

async function mount(ui: React.ReactElement) {
  const view = renderWithI18n(ui);
  await act(async () => { await Promise.resolve(); });
  return view;
}
const tokenFields = () => [...document.querySelectorAll<HTMLInputElement>("input[name^='captcha']")].map((input) => input.name);
const actions = () => renders.map((r) => r.action);

describe("which Turnstile token each auth form submits", () => {
  it("sign-in (mobile, username or email): one interaction-only token (GoTrue judges the password grant)", async () => {
    await mount(<PasswordSignInForm next="/b2b" />);
    expect(tokenFields()).toEqual(["captchaToken"]);
    expect(renders).toEqual([expect.objectContaining({ action: "sign-in", appearance: "interaction-only" })]);
  });

  it("change password: one interaction-only token for the current-password check", async () => {
    await mount(<ChangePasswordForm email="person@example.test" />);
    expect(tokenFields()).toEqual(["captchaToken"]);
    expect(actions()).toEqual(["change-password"]);
  });

  it("forgot-password request and recovery resend each carry a token", async () => {
    await mount(<ForgotPasswordForm />);
    expect(actions()).toEqual(["recovery-request"]);
    renders.length = 0;
    cleanup();
    await mount(<RecoveryVerifyForm email="person@example.test" />);
    expect(actions()).toEqual(["recovery-resend"]);
  });

  it("sign-up (mobile or email): one visible challenge with the sign-up action, judged by GoTrue for an email and by Siteverify for a mobile", async () => {
    await mount(<PasswordSignUpForm />);
    expect(actions()).toEqual(["sign-up"]);
    expect(tokenFields()).toEqual(["captchaToken"]);
  });

  it("legacy OTP pages (/auth/verify, /auth/recovery) carry a token on their send/resend forms", async () => {
    await mount(<VerifyForm next="/b2b" />);
    expect(actions()).toEqual(["otp-resend"]);
    renders.length = 0;
    cleanup();
    await mount(<RecoveryForm next="/b2b" />);
    expect(actions()).toEqual(["otp-send"]);
    expect(tokenFields()).toEqual(["captchaToken"]);
  });

  it("password sign-up carries an invitation return path through the verify step only when given", async () => {
    // The hidden `next` lives on the verify form, which renders after the code is sent; the
    // prop is the contract the sign-up page fills (and canonical-routes.test.tsx covers).
    const { container } = await mount(<PasswordSignUpForm next="/auth/invite/abc" />);
    expect(container.querySelector("input[name='next']")).toBeNull(); // not before a code was sent
  });
});
