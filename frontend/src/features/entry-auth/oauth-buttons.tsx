"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { useI18n } from "@/lib/i18n/context";
import { startEntryOAuth } from "@/server/actions/entry-oauth";
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
      className="flex min-h-10 w-full items-center justify-center gap-sm rounded-md border border-strong bg-surface px-md text-body font-medium text-fg transition-colors duration-fast hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 disabled:opacity-60"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/**
 * Google / Facebook buttons for /auth/sign-in and /auth/sign-up. Only the
 * providers switched on in Supabase Auth render; with none, nothing renders
 * (the caller hides its "OR" divider too). One button both signs in and signs
 * up, under the consent notice shown here.
 */
export function EntryOAuthButtons({ next, accountType, providers }: { next?: string; accountType?: string; providers: OAuthAvailability }) {
  const { t } = useI18n();
  if (!providers.google && !providers.facebook) return null;
  return (
    <div className="flex flex-col gap-sm" data-entry-oauth="general">
      <form action={startEntryOAuth} className="flex flex-col gap-sm">
        {next ? <input type="hidden" name="next" value={next} /> : null}
        {accountType ? <input type="hidden" name="accountType" value={accountType} /> : null}
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

export function hasOAuthProvider(providers: OAuthAvailability): boolean {
  return providers.google || providers.facebook;
}

/** The Instagram-style "──── OR ────" rule between the form and the provider buttons. */
export function OrDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-md text-label font-semibold uppercase text-fg-muted" role="separator">
      <span className="flex-1 border-t border-strong" aria-hidden="true" />
      <span>{label}</span>
      <span className="flex-1 border-t border-strong" aria-hidden="true" />
    </div>
  );
}
