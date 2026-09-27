"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Card, InlineError, InlineSuccess } from "@/components/ui/primitives";
import { Input, LabeledField, SubmitButton } from "@/components/ui/controls";
import { PhoneField } from "@/components/ui/phone-field";
import type { CanonicalPhone } from "@/lib/contact/phone";
import { setDisplayNameAction, setPhoneAction, type IdentityFieldState } from "@/server/actions/profile-identity";
import type { MyIdentity } from "@/server/queries/profile-identity";
import { AvatarField } from "./avatar-field";

const INITIAL: IdentityFieldState = { ok: false };

/**
 * The identity fields every audience shares: display name, profile photo,
 * phone. Each saves itself through its own single-purpose RPC — three
 * different authorities, never one button driving three transactions.
 *
 * Display name counts as complete ONLY once saved here
 * (`profile_set_display_name` sets display_name_confirmed_at); the value the
 * account-creation trigger filled in automatically is shown, but flagged as
 * not yet confirmed.
 */
export function IdentityCard({ identity }: { identity: MyIdentity }) {
  const { t } = useI18n();
  const [nameState, submitName] = useActionState(setDisplayNameAction, INITIAL);
  const [phoneState, submitPhone] = useActionState(setPhoneAction, INITIAL);
  const [phone, setPhone] = useState<CanonicalPhone | null>(null);

  return (
    <Card className="flex flex-col gap-lg">
      {/* id/test hook on a real element — Card forwards neither. */}
      <div id="identity" data-testid="identity-card" className="flex flex-col gap-lg">
        <AvatarField avatarUrl={identity.avatarUrl} displayName={identity.displayName} />

        <form action={submitName} className="flex flex-col gap-sm border-t pt-md" id="display-name">
          <LabeledField
            label={t("profileIdentity.displayName.label")}
            htmlFor="displayName"
            hint={t("profileIdentity.displayName.hint")}
            error={!nameState.ok && nameState.code ? t(nameState.code) : undefined}
          >
            <Input
              id="displayName"
              name="displayName"
              required
              maxLength={80}
              defaultValue={identity.displayName}
              autoComplete="name"
            />
          </LabeledField>
          <p className="text-label text-fg-muted" data-testid="display-name-status">
            {identity.displayNameConfirmed || nameState.ok
              ? t("profileIdentity.displayName.confirmedHint")
              : t("profileIdentity.displayName.unconfirmedHint")}
          </p>
          <div className="flex flex-wrap items-center gap-sm">
            <SubmitButton size="sm" pendingLabel={t("profileIdentity.displayName.saving")}>
              {t("profileIdentity.displayName.confirm")}
            </SubmitButton>
            {nameState.ok ? <InlineSuccess>{t("profileIdentity.displayName.saved")}</InlineSuccess> : null}
          </div>
        </form>

        <form action={submitPhone} className="flex flex-col gap-sm border-t pt-md" id="phone">
          <span className="text-label font-medium text-fg-secondary">{t("profileIdentity.phone.label")}</span>
          <PhoneField
            id="phone-national"
            defaultCountryIso2={identity.phoneCountryIso2}
            defaultNational={identity.phoneNational}
            onChange={setPhone}
          />
          <p className="text-label text-fg-muted">{t("profileIdentity.phone.hint")}</p>
          <input type="hidden" name="countryIso2" value={phone?.countryIso2 ?? ""} />
          <input type="hidden" name="national" value={phone?.national ?? ""} />
          <input type="hidden" name="e164" value={phone?.e164 ?? ""} />
          <div className="flex flex-wrap items-center gap-sm">
            <SubmitButton size="sm" pendingLabel={t("profileIdentity.phone.saving")} disabled={!phone}>
              {t("profileIdentity.phone.save")}
            </SubmitButton>
            {phoneState.ok ? <InlineSuccess>{t("profileIdentity.phone.saved")}</InlineSuccess> : null}
            {!phoneState.ok && phoneState.code ? <InlineError>{t(phoneState.code)}</InlineError> : null}
          </div>
        </form>
      </div>
    </Card>
  );
}
