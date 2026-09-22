"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { passwordSignIn, type PasswordAuthState } from "@/server/actions/auth-password-preview";
import { AuthCard } from "@/features/auth/auth-card";
import { Input, LabeledField, SubmitButton } from "@/components/ui/controls";
import { PasswordInput } from "./password-input";
import { TurnstileWidget } from "./turnstile-widget";

const initial: PasswordAuthState = { ok: false };

const GENERIC_ERROR_CODES = new Set([
  "authPasswordPreview.error.invalidCredentials",
  "authPasswordPreview.error.rateLimited",
]);

/**
 * Sign in preview — email + password. Every failure that isn't a rate limit
 * renders the SAME generic message (`passwordSignIn` never distinguishes
 * "no such account" from "wrong password" from "unconfirmed"/"disabled") —
 * see the server action's doc comment for why.
 */
export function PasswordSignInForm({ next }: { next: string }) {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(passwordSignIn, initial);

  return (
    <AuthCard
      title={t("authPasswordPreview.signIn.title")}
      subtitle={t("authPasswordPreview.signIn.subtitle")}
      footer={
        <div className="flex flex-col gap-1.5">
          <p>
            {t("authPasswordPreview.signIn.noAccount")}{" "}
            <Link href="/preview/auth-password/sign-up" className="font-medium text-accent hover:underline">
              {t("authPasswordPreview.signIn.signUpLink")}
            </Link>
          </p>
          <p>
            <Link href="/preview/auth-password/forgot-password" className="text-fg-muted hover:text-fg hover:underline">
              {t("authPasswordPreview.signIn.forgotPassword")}
            </Link>
          </p>
        </div>
      }
    >
      <form action={dispatch} className="flex flex-col gap-md" noValidate>
        <input type="hidden" name="next" value={next} />
        {state.code && GENERIC_ERROR_CODES.has(state.code) ? (
          <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-md py-2.5 text-body text-danger">
            {t(state.code)}
          </p>
        ) : null}
        <LabeledField label={t("authPasswordPreview.emailLabel")} htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            defaultValue={state.email ?? ""}
            placeholder={t("authPasswordPreview.emailPlaceholder")}
            aria-invalid={Boolean(state.code) || undefined}
          />
        </LabeledField>

        <LabeledField label={t("authPasswordPreview.passwordLabel")} htmlFor="password">
          <PasswordInput id="password" name="password" autoComplete="current-password" required aria-invalid={Boolean(state.code) || undefined} />
        </LabeledField>

        {/* Invisible, non-interactive — see turnstile-widget.tsx's doc
            comment: GoTrue's captcha toggle is all-or-nothing, so Sign In
            needs a token too, but adds no visible challenge or extra click. */}
        <TurnstileWidget resetKey={state} variant="invisible" />

        <SubmitButton className="w-full" pendingLabel={t("authPasswordPreview.signIn.submitting")}>
          {t("authPasswordPreview.signIn.submit")}
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
