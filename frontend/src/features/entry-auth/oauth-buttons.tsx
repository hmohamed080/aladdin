"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { useI18n } from "@/lib/i18n/context";
import { startEntryOAuth } from "@/server/actions/entry-oauth";
import { startGeneralOAuth } from "@/server/actions/general-oauth";
import type { EntryKind } from "@/server/auth/entry-email";
import type { OAuthAvailability, OAuthProvider } from "@/server/auth/entry-oauth";


/** Provider marks in their own brand colours, served as static files (brand assets, not UI tokens). */
const ProviderMark = ({ provider }: { provider: OAuthProvider }) => (
  // eslint-disable-next-line @next/next/no-img-element -- a 20px static SVG; next/image adds nothing here.
  <img src={`/assets/oauth/${provider}.svg`} alt="" aria-hidden="true" width={20} height={20} />
);

function ProviderButton({ provider, label, icon }: { provider: OAuthProvider; label: string; icon: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="provider"
      value={provider}
      disabled={pending}
      aria-busy={pending}
      data-oauth-provider={provider}
      className="flex min-h-12 w-full items-center justify-center gap-sm rounded-md border border-strong bg-surface px-md text-body font-medium text-fg transition-colors duration-fast hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 disabled:opacity-60"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/**
 * Google / Facebook for `/auth/sign-in` and `/auth/sign-up`, followed by an
 * "or" divider before the email form. Registered people sign in; a first-time
 * person continues into the normal registration steps. Renders nothing when
 * no provider is switched on.
 */
export function GeneralOAuthButtons({ next, providers }: { next?: string; providers: OAuthAvailability }) {
  const { t } = useI18n();
  if (!providers.google && !providers.facebook) return null;
  return (
    <div className="flex flex-col gap-md" data-general-oauth>
      <form action={startGeneralOAuth} className="flex flex-col gap-sm">
        {next ? <input type="hidden" name="next" value={next} /> : null}
        {providers.google ? <ProviderButton provider="google" label={t("entryAuth.continueWithGoogle")} icon={<ProviderMark provider="google" />} /> : null}
        {providers.facebook ? <ProviderButton provider="facebook" label={t("entryAuth.continueWithFacebook")} icon={<ProviderMark provider="facebook" />} /> : null}
        <p className="text-center text-label text-fg-muted">
          {t("entryAuth.oauthConsentPrefix")}{" "}
          <Link href="/legal/terms" target="_blank" className="underline underline-offset-4">
            {t("entryAuth.terms")}
          </Link>{" "}
          {t("entryAuth.and")}{" "}
          <Link href="/legal/privacy" target="_blank" className="underline underline-offset-4">
            {t("entryAuth.privacy")}
          </Link>
        </p>
      </form>
      <div className="flex items-center gap-sm text-label text-fg-muted" aria-hidden="true">
        <span className="flex-1 border-t border-strong" />
        {t("entryAuth.or")}
        <span className="flex-1 border-t border-strong" />
      </div>
    </div>
  );
}

/**
 * Google / Facebook buttons for a Showroom or Installer entry page. Only the
 * providers switched on in Supabase Auth render; with none, nothing renders.
 * One button both signs in and signs up: a new person gets an account of the
 * page's kind, under the consent notice shown here.
 */
export function EntryOAuthButtons({ kind, next, providers }: { kind: EntryKind; next?: string; providers: OAuthAvailability }) {
  const { t } = useI18n();
  if (!providers.google && !providers.facebook) return null;
  return (
    <div className="flex flex-col gap-sm" data-entry-oauth={kind}>
      <form action={startEntryOAuth} className="flex flex-col gap-sm">
        <input type="hidden" name="kind" value={kind} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        {providers.google ? <ProviderButton provider="google" label={t("entryAuth.continueWithGoogle")} icon={<ProviderMark provider="google" />} /> : null}
        {providers.facebook ? <ProviderButton provider="facebook" label={t("entryAuth.continueWithFacebook")} icon={<ProviderMark provider="facebook" />} /> : null}
      </form>
      <p className="text-center text-label text-fg-muted">
        {t("entryAuth.oauthConsentPrefix")}{" "}
        <Link href="/legal/terms" target="_blank" className="underline underline-offset-4">
          {t("entryAuth.terms")}
        </Link>{" "}
        {t("entryAuth.and")}{" "}
        <Link href="/legal/privacy" target="_blank" className="underline underline-offset-4">
          {t("entryAuth.privacy")}
        </Link>
      </p>
    </div>
  );
}
