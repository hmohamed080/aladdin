"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { passwordSignIn, type PasswordAuthState } from "@/server/actions/auth-password-preview";
import type { OAuthAvailability } from "@/server/auth/entry-oauth";
import { AuthCard } from "@/features/auth/auth-card";
import { EntryOAuthButtons, OrDivider, hasOAuthProvider } from "@/features/entry-auth/oauth-buttons";
import { Input, SubmitButton } from "@/components/ui/controls";
import { PasswordInput } from "./password-input";
import { TurnstileWidget } from "./turnstile-widget";

const initial: PasswordAuthState = { ok: false };
const NO_PROVIDERS: OAuthAvailability = { google: false, facebook: false };

const GENERIC_ERROR_CODES = new Set([
  "authPasswordPreview.error.invalidCredentials",
  "authPasswordPreview.error.rateLimited",
  "authPasswordPreview.error.captchaRequired",
  "authPasswordPreview.error.captchaRejected",
  "authPasswordPreview.error.captchaUnavailable",
]);

/** OAuth round-trip failures the callback reports back here (`?error=`). */
const OAUTH_ERRORS: Record<string, string> = {
  oauth: "entryAuth.error.oauth",
  oauth_email: "entryAuth.error.oauthEmail",
};

/**
 * Canonical sign in, Instagram style: ONE field that takes a mobile number, a
 * username or an email, then the password. The server works out which it is
 * (lib/auth/sign-in-identifier.ts) and every failure that isn't a rate limit
 * renders the SAME generic message — `passwordSignIn` never distinguishes "no
 * such account" from "wrong password" from "unconfirmed"/"disabled". Google /
 * Facebook sit under an "OR" rule when Supabase has them switched on.
 */
export function PasswordSignInForm({
  next,
  providers = NO_PROVIDERS,
  oauthError,
}: {
  next: string;
  providers?: OAuthAvailability;
  oauthError?: string;
}) {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(passwordSignIn, initial);
  const oauthMessage = oauthError ? OAUTH_ERRORS[oauthError] : undefined;

  return (
    <AuthCard
      title={t("authPasswordPreview.signIn.title")}
      subtitle={t("authPasswordPreview.signIn.subtitle")}
      footer={
        <p>
          {t("authPasswordPreview.signIn.noAccount")}{" "}
          <Link href="/auth/sign-up" className="font-semibold text-accent hover:underline">
            {t("authPasswordPreview.signIn.signUpLink")}
          </Link>
        </p>
      }
    >
      <form action={dispatch} className="flex flex-col gap-sm" noValidate>
        <input type="hidden" name="next" value={next} />
        {state.code && GENERIC_ERROR_CODES.has(state.code) ? (
          <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-md py-2.5 text-body text-danger">
            {t(state.code)}
          </p>
        ) : oauthMessage ? (
          <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-md py-2.5 text-body text-danger">
            {t(oauthMessage)}
          </p>
        ) : null}
        <label htmlFor="identifier" className="sr-only">
          {t("authPasswordPreview.signIn.identifierLabel")}
        </label>
        <Input
          id="identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          dir="ltr"
          required
          defaultValue={state.email ?? ""}
          placeholder={t("authPasswordPreview.signIn.identifierLabel")}
          aria-invalid={Boolean(state.code) || undefined}
        />
        <label htmlFor="password" className="sr-only">
          {t("authPasswordPreview.passwordLabel")}
        </label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          placeholder={t("authPasswordPreview.passwordLabel")}
          aria-invalid={Boolean(state.code) || undefined}
        />

        {/* GoTrue protects the password grant with CAPTCHA: an interaction-only
            challenge (shown only if Cloudflare needs the person to act). */}
        <TurnstileWidget name="captchaToken" action="sign-in" appearance="interaction-only" resetKey={state} />

        <SubmitButton className="mt-xs w-full" pendingLabel={t("authPasswordPreview.signIn.submitting")}>
          {t("authPasswordPreview.signIn.submit")}
        </SubmitButton>
      </form>

      {hasOAuthProvider(providers) ? (
        <>
          <OrDivider label={t("authPasswordPreview.signIn.or")} />
          <EntryOAuthButtons next={next} providers={providers} />
        </>
      ) : null}

      <p className="text-center text-body">
        <Link href="/auth/forgot-password" className="text-fg-secondary hover:text-fg hover:underline">
          {t("authPasswordPreview.signIn.forgotPassword")}
        </Link>
      </p>
    </AuthCard>
  );
}
