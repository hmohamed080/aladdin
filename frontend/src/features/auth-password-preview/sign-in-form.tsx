"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { passwordSignIn, type PasswordAuthState } from "@/server/actions/auth-password-preview";
import type { OAuthAvailability } from "@/server/auth/entry-oauth";
import { AuthCard } from "@/features/auth/auth-card";
import { GeneralOAuthButtons } from "@/features/entry-auth/oauth-buttons";
import { Input, LabeledField, SubmitButton } from "@/components/ui/controls";
import { PasswordInput } from "./password-input";
import { TurnstileWidget } from "./turnstile-widget";

const initial: PasswordAuthState = { ok: false };

const GENERIC_ERROR_CODES = new Set([
  "authPasswordPreview.error.invalidCredentials",
  "authPasswordPreview.error.rateLimited",
  "authPasswordPreview.error.captchaRequired",
  "authPasswordPreview.error.captchaRejected",
  "authPasswordPreview.error.captchaUnavailable",
]);

/**
 * Canonical sign in — email + password. Every failure that isn't a rate limit
 * renders the SAME generic message (`passwordSignIn` never distinguishes
 * "no such account" from "wrong password" from "unconfirmed"/"disabled") —
 * see the server action's doc comment for why.
 *
 * A secondary link sends installer/technician accounts, which sign in with
 * phone + password, to `/installer/sign-in`; the page passes a href carrying
 * only a validated `next` (app/auth/sign-in/installer-sign-in-href.ts).
 */
export function PasswordSignInForm({
  next,
  installerSignInHref = "/installer/sign-in",
  providers = { google: false, facebook: false },
  oauthError,
}: {
  next: string;
  installerSignInHref?: string;
  /** Google / Facebook switched on in Supabase Auth; each one that is off renders no button. */
  providers?: OAuthAvailability;
  /** `?error=` the OAuth callback came back with (allow-listed here, never shown raw). */
  oauthError?: string;
}) {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(passwordSignIn, initial);
  const oauthErrorKey = oauthError === "oauth" ? "entryAuth.error.oauth" : oauthError === "oauth_email" ? "entryAuth.error.oauthEmail" : null;

  return (
    <AuthCard
      title={t("authPasswordPreview.signIn.title")}
      subtitle={t("authPasswordPreview.signIn.subtitle")}
      footer={
        <div className="flex flex-col gap-1.5">
          <p>
            {t("authPasswordPreview.signIn.noAccount")}{" "}
            <Link href="/auth/sign-up" className="font-medium text-accent hover:underline">
              {t("authPasswordPreview.signIn.signUpLink")}
            </Link>
          </p>
          <p>
            <Link href="/auth/forgot-password" className="text-fg-muted hover:text-fg hover:underline">
              {t("authPasswordPreview.signIn.forgotPassword")}
            </Link>
          </p>
          <p>
            <Link href={installerSignInHref} className="text-fg-muted hover:text-fg hover:underline">
              {t("auth.installerPhoneSignIn")}
            </Link>
          </p>
          <p><Link href={`/showroom/sign-in?next=${encodeURIComponent(next)}`} className="text-fg-muted hover:text-fg hover:underline">{t("showroomAuth.phoneSignIn")}</Link></p>
        </div>
      }
    >
      {oauthErrorKey ? (
        <p role="alert" className="mb-md rounded-md border border-danger/40 bg-danger/10 px-md py-2.5 text-body text-danger">
          {t(oauthErrorKey)}
        </p>
      ) : null}
      <GeneralOAuthButtons next={next === "/b2b" ? undefined : next} providers={providers} />
      <form action={dispatch} className={providers.google || providers.facebook ? "mt-md flex flex-col gap-md" : "flex flex-col gap-md"} noValidate>
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

        {/* GoTrue protects the password grant with CAPTCHA: an interaction-only
            challenge (shown only if Cloudflare needs the person to act). */}
        <TurnstileWidget name="captchaToken" action="sign-in" appearance="interaction-only" resetKey={state} />

        <SubmitButton className="w-full" pendingLabel={t("authPasswordPreview.signIn.submitting")}>
          {t("authPasswordPreview.signIn.submit")}
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
