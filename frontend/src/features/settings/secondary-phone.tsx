"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Badge, InlineError, InlineSuccess } from "@/components/ui/primitives";
import { Input, LabeledField, SubmitButton } from "@/components/ui/controls";
import { PhoneField } from "@/components/ui/phone-field";
import { splitE164, type CanonicalPhone } from "@/lib/contact/phone";
import { formatDate } from "@/lib/ui/format";
import type { IdentityFieldState } from "@/server/actions/profile-identity";
import {
  cancelSecondaryPhoneAction,
  makeSecondaryPhonePrimaryAction,
  renewSecondaryPhoneAction,
  saveSecondaryPhoneAction,
} from "@/server/actions/secondary-phone";
import type { SecondaryPhone } from "@/server/queries/profile-identity";

const INITIAL: IdentityFieldState = { ok: false };

function Outcome({ state }: { state: IdentityFieldState }) {
  const { t } = useI18n();
  if (!state.code) return null;
  return state.ok ? <InlineSuccess>{t(state.code)}</InlineSuccess> : <InlineError>{t(state.code)}</InlineError>;
}

/**
 * The unverified second phone. It is held for 7 days (one renewal adds 7 more), is never used to sign in or
 * recover the account, and is not a verified contact. Adding, changing or making it the main phone asks for the
 * current password; the database enforces every rule (server/actions/secondary-phone.ts).
 */
export function SecondaryPhoneSection({ secondary, phoneLogin }: { secondary: SecondaryPhone | null; phoneLogin: boolean }) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState<CanonicalPhone | null>(null);
  const [saveState, save] = useActionState(saveSecondaryPhoneAction, INITIAL);
  const [renewState, renew] = useActionState(renewSecondaryPhoneAction, INITIAL);
  const [cancelState, cancel] = useActionState(cancelSecondaryPhoneAction, INITIAL);
  const [primaryState, makePrimary] = useActionState(makeSecondaryPhonePrimaryAction, INITIAL);
  const split = secondary ? splitE164(secondary.phone) : null;
  const showForm = !secondary || editing;

  return (
    <div className="flex flex-col gap-sm border-t pt-md" id="secondary-phone" data-testid="secondary-phone">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-label font-medium text-fg-secondary">{t("profileIdentity.secondaryPhone.label")}</span>
        <Badge tone="warning">{t("profileIdentity.secondaryPhone.unverified")}</Badge>
      </div>
      <p className="text-label text-fg-muted">{t("profileIdentity.secondaryPhone.hint")}</p>

      {secondary ? (
        <div className="flex flex-col gap-sm rounded-sm bg-surface-2/50 px-3 py-2.5" data-testid="secondary-phone-current">
          <span dir="ltr" className="text-body font-medium text-fg">{secondary.phone}</span>
          <span className="text-label text-fg-muted">
            {t("profileIdentity.secondaryPhone.heldUntil", { date: formatDate(secondary.expiresAt, locale) })}
            {secondary.canRenew ? "" : ` · ${t("profileIdentity.secondaryPhone.noMoreRenewals")}`}
          </span>
          <div className="flex flex-wrap items-center gap-sm">
            {secondary.canRenew ? (
              <form action={renew}>
                <SubmitButton size="sm" variant="outline" pendingLabel={t("profileIdentity.secondaryPhone.working")}>
                  {t("profileIdentity.secondaryPhone.renew")}
                </SubmitButton>
              </form>
            ) : null}
            {!editing ? (
              <button type="button" className="text-label font-medium text-accent hover:underline" onClick={() => setEditing(true)}>
                {t("profileIdentity.secondaryPhone.change")}
              </button>
            ) : null}
            <form action={cancel}>
              <SubmitButton size="sm" variant="ghost" pendingLabel={t("profileIdentity.secondaryPhone.working")}>
                {t("profileIdentity.secondaryPhone.remove")}
              </SubmitButton>
            </form>
          </div>
          <Outcome state={renewState} />
          <Outcome state={cancelState} />
          {!phoneLogin ? (
            <form action={makePrimary} className="flex flex-col gap-sm border-t pt-sm">
              <input type="hidden" name="e164" value={secondary.phone} />
              <input type="hidden" name="countryIso2" value={split?.countryIso2 ?? ""} />
              <input type="hidden" name="national" value={split?.national ?? ""} />
              <LabeledField label={t("profileIdentity.secondaryPhone.password")} htmlFor="secondary-primary-password">
                <Input id="secondary-primary-password" name="password" type="password" autoComplete="current-password" required />
              </LabeledField>
              <div className="flex flex-wrap items-center gap-sm">
                <SubmitButton size="sm" variant="outline" pendingLabel={t("profileIdentity.secondaryPhone.working")}>
                  {t("profileIdentity.secondaryPhone.makePrimary")}
                </SubmitButton>
                <Outcome state={primaryState} />
              </div>
            </form>
          ) : null}
        </div>
      ) : null}

      {showForm ? (
        <form action={save} className="flex flex-col gap-sm">
          <input type="hidden" name="mode" value={secondary ? "change" : "reserve"} />
          <input type="hidden" name="e164" value={phone?.e164 ?? ""} />
          <PhoneField id="secondary-phone-national" onChange={setPhone} />
          <LabeledField
            label={t("profileIdentity.secondaryPhone.password")}
            htmlFor="secondary-phone-password"
            hint={t("profileIdentity.secondaryPhone.passwordHint")}
          >
            <Input id="secondary-phone-password" name="password" type="password" autoComplete="current-password" required />
          </LabeledField>
          <div className="flex flex-wrap items-center gap-sm">
            <SubmitButton size="sm" pendingLabel={t("profileIdentity.secondaryPhone.working")} disabled={!phone}>
              {secondary ? t("profileIdentity.secondaryPhone.saveChange") : t("profileIdentity.secondaryPhone.add")}
            </SubmitButton>
            {secondary ? (
              <button type="button" className="text-label text-fg-muted hover:underline" onClick={() => setEditing(false)}>
                {t("profileIdentity.secondaryPhone.cancelEdit")}
              </button>
            ) : null}
            <Outcome state={saveState} />
          </div>
        </form>
      ) : null}
    </div>
  );
}
