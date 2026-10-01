import { describe, expect, it, vi, beforeEach } from "vitest";
import { isValidElement, type ReactElement } from "react";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

const recoveryFlowEmail = vi.fn<() => Promise<string | null>>();
const requireRecoverySession = vi.fn<() => Promise<{ email: string } | null>>();
const consumeRecoverySuccess = vi.fn<() => Promise<boolean>>();
vi.mock("@/server/actions/auth-password-preview", () => ({
  recoveryFlowEmail: () => recoveryFlowEmail(),
  requireRecoverySession: () => requireRecoverySession(),
  consumeRecoverySuccess: () => consumeRecoverySuccess(),
}));

// The canonical pages are thin route boundaries over the tested password
// components; stand-ins keep this test about ROUTING, not form rendering.
vi.mock("@/features/auth-password-preview/sign-up-form", () => ({ PasswordSignUpForm: () => null }));
vi.mock("@/features/auth-password-preview/sign-in-form", () => ({ PasswordSignInForm: () => null }));
vi.mock("@/features/auth-password-preview/forgot-password-form", () => ({ ForgotPasswordForm: () => null }));
vi.mock("@/features/auth-password-preview/recovery-verify-form", () => ({ RecoveryVerifyForm: () => null }));
vi.mock("@/features/auth-password-preview/recovery-reset-form", () => ({ RecoveryResetForm: () => null }));
vi.mock("@/features/auth-password-preview/recovery-success", () => ({ RecoverySuccess: () => null }));

import { PasswordSignUpForm } from "@/features/auth-password-preview/sign-up-form";
import { PasswordSignInForm } from "@/features/auth-password-preview/sign-in-form";
import { ForgotPasswordForm } from "@/features/auth-password-preview/forgot-password-form";
import { RecoveryVerifyForm } from "@/features/auth-password-preview/recovery-verify-form";
import { RecoveryResetForm } from "@/features/auth-password-preview/recovery-reset-form";
import { RecoverySuccess } from "@/features/auth-password-preview/recovery-success";

import SignUpPage from "./sign-up/page";
import SignInPage from "./sign-in/page";
import ForgotPasswordPage from "./forgot-password/page";
import RecoveryVerifyPage from "./forgot-password/verify/page";
import RecoveryResetPage from "./forgot-password/reset/page";
import RecoverySuccessPage from "./forgot-password/success/page";

import LegacySignUp from "../preview/auth-password/sign-up/page";
import LegacySignIn from "../preview/auth-password/sign-in/page";
import LegacyForgot from "../preview/auth-password/forgot-password/page";
import LegacyVerify from "../preview/auth-password/forgot-password/verify/page";
import LegacyReset from "../preview/auth-password/forgot-password/reset/page";
import LegacySuccess from "../preview/auth-password/forgot-password/success/page";
import LegacyFinish from "../preview/auth-password/finish-registration/page";

function element(node: unknown): ReactElement<Record<string, unknown>> {
  expect(isValidElement(node)).toBe(true);
  return node as ReactElement<Record<string, unknown>>;
}

const params = <T extends object>(value: T) => ({ searchParams: Promise.resolve(value) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("canonical /auth/* routes render the tested password flow", () => {
  it("/auth/sign-up → PasswordSignUpForm", () => {
    expect(element(SignUpPage()).type).toBe(PasswordSignUpForm);
  });

  it("/auth/sign-in → PasswordSignInForm with a sanitized next", async () => {
    const safe = element(await SignInPage(params({ next: "/b2b/leads" })));
    expect(safe.type).toBe(PasswordSignInForm);
    expect(safe.props.next).toBe("/b2b/leads");
    const hostile = element(await SignInPage(params({ next: "https://evil.example/steal" })));
    expect(hostile.props.next).not.toContain("evil");
  });

  it("/auth/sign-in links installers to /installer/sign-in when there is no next", async () => {
    expect(element(await SignInPage(params({}))).props.installerSignInHref).toBe("/installer/sign-in");
  });

  it("/auth/sign-in forwards a validated next to the installer link, encoded", async () => {
    const page = element(await SignInPage(params({ next: "/home/points?tab=open" })));
    expect(page.props.installerSignInHref).toBe(`/installer/sign-in?next=${encodeURIComponent("/home/points?tab=open")}`);
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/settings/elsewhere", ""])(
    "/auth/sign-in never forwards an unsafe next to the installer link (%s)",
    async (next) => {
      const page = element(await SignInPage(params({ next })));
      expect(page.props.installerSignInHref).toBe("/installer/sign-in");
    },
  );

  it("/auth/forgot-password → ForgotPasswordForm", () => {
    expect(element(ForgotPasswordPage()).type).toBe(ForgotPasswordForm);
  });

  it("/auth/forgot-password/verify needs the flow cookie, else back to /auth/forgot-password", async () => {
    recoveryFlowEmail.mockResolvedValueOnce("person@example.test");
    expect(element(await RecoveryVerifyPage()).type).toBe(RecoveryVerifyForm);
    recoveryFlowEmail.mockResolvedValueOnce(null);
    await expect(RecoveryVerifyPage()).rejects.toThrow("REDIRECT:/auth/forgot-password");
  });

  it("/auth/forgot-password/reset needs a recovery session, else back to /auth/forgot-password", async () => {
    requireRecoverySession.mockResolvedValueOnce({ email: "person@example.test" });
    expect(element(await RecoveryResetPage()).type).toBe(RecoveryResetForm);
    requireRecoverySession.mockResolvedValueOnce(null);
    await expect(RecoveryResetPage()).rejects.toThrow("REDIRECT:/auth/forgot-password");
  });

  it("/auth/forgot-password/success needs the success marker, else back to /auth/forgot-password", async () => {
    consumeRecoverySuccess.mockResolvedValueOnce(true);
    expect(element(await RecoverySuccessPage()).type).toBe(RecoverySuccess);
    consumeRecoverySuccess.mockResolvedValueOnce(false);
    await expect(RecoverySuccessPage()).rejects.toThrow("REDIRECT:/auth/forgot-password");
  });
});

describe("legacy /preview/auth-password/* URLs are server-side redirects to /auth/*", () => {
  it.each([
    ["sign-up", LegacySignUp, "/auth/sign-up"],
    ["forgot-password", LegacyForgot, "/auth/forgot-password"],
    ["forgot-password/verify", LegacyVerify, "/auth/forgot-password/verify"],
    ["forgot-password/reset (old recovery redirectTo)", LegacyReset, "/auth/forgot-password/reset"],
    ["forgot-password/success", LegacySuccess, "/auth/forgot-password/success"],
  ] as const)("%s → %s", (_label, Page, target) => {
    expect(() => (Page as () => never)()).toThrow(`REDIRECT:${target}`);
  });

  it("sign-in preserves a safe next", async () => {
    await expect(LegacySignIn(params({ next: "/b2b/leads?tab=open" }))).rejects.toThrow(
      `REDIRECT:/auth/sign-in?next=${encodeURIComponent("/b2b/leads?tab=open")}`,
    );
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)"])(
    "sign-in drops an unsafe next (%s)",
    async (next) => {
      await expect(LegacySignIn(params({ next }))).rejects.toThrow(/^REDIRECT:\/auth\/sign-in$/);
    },
  );

  it("sign-in with no next goes to plain /auth/sign-in", async () => {
    await expect(LegacySignIn(params({}))).rejects.toThrow(/^REDIRECT:\/auth\/sign-in$/);
  });

  it("finish-registration forwards only the allow-listed reason", async () => {
    await expect(LegacyFinish(params({ reason: "username_unavailable" }))).rejects.toThrow(
      "REDIRECT:/auth/finish-registration?reason=username_unavailable",
    );
    await expect(LegacyFinish(params({ reason: "<script>" }))).rejects.toThrow(/^REDIRECT:\/auth\/finish-registration$/);
  });
});
