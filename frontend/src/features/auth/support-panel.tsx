"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { AuthCard } from "@/features/auth/auth-card";
import { StatePanel } from "@/components/ui/primitives";
import { AlertIcon } from "@/components/ui/icons";

/** Render the configured support contact as a safe link, or plain text. */
function ContactValue({ contact }: { contact: string }) {
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
  const isUrl = /^https?:\/\/\S+$/.test(contact);
  if (isEmail) {
    return <a href={`mailto:${contact}`} className="font-medium text-accent hover:underline" dir="ltr">{contact}</a>;
  }
  if (isUrl) {
    return (
      <a href={contact} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline" dir="ltr">
        {contact}
      </a>
    );
  }
  return <span className="font-medium text-fg">{contact}</span>;
}

/**
 * Lost-channel support. Explains that the pilot never changes an account's email
 * automatically and that access is restored only through a manual identity review.
 * Reveals nothing about whether a given email has an account. If no support contact
 * is configured for the environment, shows a safe "unavailable" state instead of a
 * fabricated address.
 */
export function SupportPanel({ contact }: { contact: string | null }) {
  const { t } = useI18n();
  return (
    <AuthCard
      title={t("support.title")}
      subtitle={t("support.intro")}
      footer={
        <Link href="/auth/sign-in" className="text-fg-muted hover:text-fg hover:underline">
          {t("support.backToSignIn")}
        </Link>
      }
    >
      <div className="flex flex-col gap-md">
        <section className="flex flex-col gap-1.5 rounded-md border border-strong/70 bg-surface-2/40 p-md">
          <h2 className="text-label font-medium text-fg-secondary">{t("support.reviewTitle")}</h2>
          <p className="text-body text-fg">{t("support.reviewBody")}</p>
        </section>

        {contact ? (
          <p className="text-body text-fg">
            {t("support.contactLabel")}: <ContactValue contact={contact} />
          </p>
        ) : (
          <StatePanel icon={<AlertIcon size={22} />} title={t("support.unavailableTitle")} body={t("support.unavailableBody")} tone="warning" />
        )}

        <p className="text-label text-fg-muted">{t("support.noRevealNote")}</p>
      </div>
    </AuthCard>
  );
}
