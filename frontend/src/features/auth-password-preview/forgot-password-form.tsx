"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { requestRecoveryCode, type PasswordAuthState } from "@/server/actions/auth-password-preview";
import { AuthCard } from "@/features/auth/auth-card";
import { Input, LabeledField, SubmitButton } from "@/components/ui/controls";
import { TurnstileWidget } from "./turnstile-widget";

const initial: PasswordAuthState = { ok: false };

/**
 * Forgot Password — SCREEN 1 of 4 (docs/frontend/auth-password-preview.md
 * §Forgot password screens). Deliberately minimal: title, explanation, email,
 * Send Code, Back to Sign In — nothing else. On success the action itself
 * redirects to Screen 2 (a real route boundary, not a conditional render);
 * this component only ever renders the request form or its rate-limit error.
 */
export function ForgotPasswordForm() {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(requestRecoveryCode, initial);

  return (
    <AuthCard
      title={t("authPasswordPreview.forgotPassword.title")}
      subtitle={t("authPasswordPreview.forgotPassword.subtitle")}
      footer={
        <Link href="/preview/auth-password/sign-in" className="text-fg-muted hover:text-fg hover:underline">
          {t("authPasswordPreview.forgotPassword.backToSignIn")}
        </Link>
      }
    >
      <form action={dispatch} className="flex flex-col gap-md" noValidate>
        <LabeledField
          label={t("authPasswordPreview.emailLabel")}
          htmlFor="email"
          error={state.code ? t(state.code) : undefined}
        >
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            placeholder={t("authPasswordPreview.emailPlaceholder")}
            aria-invalid={Boolean(state.code) || undefined}
          />
        </LabeledField>
        <TurnstileWidget resetKey={state} />
        <SubmitButton className="w-full" pendingLabel={t("authPasswordPreview.forgotPassword.submitting")}>
          {t("authPasswordPreview.forgotPassword.submit")}
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
