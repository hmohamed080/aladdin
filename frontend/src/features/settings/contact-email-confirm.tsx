"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/controls";
import { Card, InlineError, InlineSuccess } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/context";
import { confirmContactEmailAction, type ContactEmailState } from "@/server/actions/contact-email";

const INITIAL: ContactEmailState = { ok: false };

/**
 * The explicit confirmation of a contact-email link. The page that renders this performed NO write; only pressing
 * Confirm (a POST) verifies the address.
 */
export function ContactEmailConfirm({ token, state, maskedEmail }: { token: string; state: "valid" | "expired" | "invalid"; maskedEmail: string | null }) {
  const { t } = useI18n();
  const [result, submit] = useActionState(confirmContactEmailAction, INITIAL);

  if (result.ok) {
    return (
      <Card className="flex flex-col gap-sm">
        <InlineSuccess>{t("contactEmail.verified")}</InlineSuccess>
        <Link href="/home/settings" className="text-label font-medium text-accent hover:underline">{t("contactEmail.confirm.back")}</Link>
      </Card>
    );
  }
  if (state !== "valid") {
    return (
      <Card className="flex flex-col gap-sm">
        <InlineError>{t(state === "expired" ? "contactEmail.error.linkExpired" : "contactEmail.error.linkInvalid")}</InlineError>
        <Link href="/home/settings" className="text-label font-medium text-accent hover:underline">{t("contactEmail.confirm.back")}</Link>
      </Card>
    );
  }
  return (
    <Card className="flex flex-col gap-sm">
      <p className="text-body text-fg">{t("contactEmail.confirm.body", { email: maskedEmail ?? "" })}</p>
      <form action={submit} className="flex flex-col gap-sm">
        <input type="hidden" name="token" value={token} />
        <SubmitButton data-testid="contact-email-confirm-submit">{t("contactEmail.confirm.action")}</SubmitButton>
      </form>
      {result.code && !result.ok ? <InlineError>{t(result.code)}</InlineError> : null}
    </Card>
  );
}
