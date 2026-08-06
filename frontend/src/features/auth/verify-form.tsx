"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { verifyEmailOtp, type AuthState } from "@/server/actions/auth";
import { AuthCard } from "@/features/auth/auth-card";
import { Input, LabeledField, SubmitButton } from "@/components/ui/controls";

const initial: AuthState = { ok: false };

/**
 * Standalone verification: a single form for someone who already requested a code
 * and wants to enter their email + code together (e.g. resuming on a new tab).
 * The email is entered here, never carried in the URL (no PII in query strings).
 * Verifies via the Sign In action (`shouldCreateUser: false`).
 */
export function VerifyForm({ next }: { next: string }) {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(verifyEmailOtp, initial);
  const invalidEmail = state.code === "auth.error.invalidEmail";
  const invalidCode = state.code && !state.ok && !invalidEmail;

  return (
    <AuthCard
      title={t("auth.verifyTitle")}
      subtitle={t("auth.verifySubtitle")}
      footer={
        <p>
          <Link href="/auth/sign-in" className="text-fg-muted hover:text-fg hover:underline">
            {t("support.backToSignIn")}
          </Link>
        </p>
      }
    >
      <form action={dispatch} className="flex flex-col gap-md" noValidate>
        <input type="hidden" name="next" value={next} />
        <LabeledField
          label={t("auth.emailLabel")}
          htmlFor="email"
          error={invalidEmail ? t("auth.error.invalidEmail") : undefined}
        >
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            placeholder={t("auth.emailPlaceholder")}
            aria-invalid={invalidEmail ? true : undefined}
          />
        </LabeledField>
        <LabeledField
          label={t("auth.codeLabel")}
          htmlFor="token"
          error={invalidCode ? t(state.code as string) : undefined}
        >
          <Input
            id="token"
            name="token"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            placeholder={t("auth.codePlaceholder")}
            aria-invalid={invalidCode ? true : undefined}
            className="text-center font-mono text-title tracking-[0.4em]"
          />
        </LabeledField>
        <SubmitButton className="w-full" pendingLabel={t("auth.verifying")}>{t("auth.verify")}</SubmitButton>
      </form>
    </AuthCard>
  );
}
