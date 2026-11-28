"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Button, Checkbox, Input, LabeledField } from "@/components/ui/controls";
import { PhoneField } from "@/components/ui/phone-field";
import { InlineError, InlineSuccess } from "@/components/ui/primitives";
import { splitE164 } from "@/lib/contact/phone";
import { saveOrganizationContactAction, type ContactState } from "@/server/actions/contacts";

export type OrganizationContactView = {
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  showPhone: boolean;
  showWhatsapp: boolean;
  showEmail: boolean;
};

const initial: ContactState = { ok: false };

/**
 * The business contact entered at registration (phone, e-mail) plus an optional WhatsApp number, with the
 * owner-controlled visibility of each. The phone and e-mail are the SAME values the Admin Dashboard shows -
 * `organization_contact_set` writes both - so editing here is editing the registered data. `canManage` only
 * decides what is drawn; the RPC refuses everyone without a live org.manage.
 */
export function OrganizationContactCard({
  orgId,
  contact,
  canManage,
  phoneRequired,
}: {
  orgId: string;
  contact: OrganizationContactView;
  canManage: boolean;
  /** A showroom cannot clear its business phone (the database enforces it; this only explains it). */
  phoneRequired: boolean;
}) {
  const { t } = useI18n();
  const [state, dispatch, pending] = useActionState(saveOrganizationContactAction, initial);
  const [phone, setPhone] = useState<string | null>(contact.phone);
  const [whatsapp, setWhatsapp] = useState<string | null>(contact.whatsapp);
  const [phoneInvalid, setPhoneInvalid] = useState(false);
  const [whatsappInvalid, setWhatsappInvalid] = useState(false);
  const [email, setEmail] = useState(contact.email ?? "");
  const [showPhone, setShowPhone] = useState(contact.showPhone);
  const [showWhatsapp, setShowWhatsapp] = useState(contact.showWhatsapp);
  const [showEmail, setShowEmail] = useState(contact.showEmail);

  if (!canManage) {
    return (
      <dl className="grid gap-md tablet:grid-cols-2" data-testid="organization-contact-readonly">
        <ReadOnly label={t("showroomSettings.contact.phone")} value={contact.phone} />
        <ReadOnly label={t("showroomSettings.contact.email")} value={contact.email} />
      </dl>
    );
  }

  const savedPhone = splitE164(contact.phone);
  const savedWhatsapp = splitE164(contact.whatsapp);
  const blocked = pending || phoneInvalid || whatsappInvalid || (phoneRequired && !phone);

  return (
    <form action={dispatch} className="flex flex-col gap-md" data-testid="organization-contact-form" noValidate>
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="phone" value={phone ?? ""} />
      <input type="hidden" name="whatsapp" value={whatsapp ?? ""} />

      <LabeledField label={t("showroomSettings.contact.phone")} htmlFor="contact-phone" optional={phoneRequired ? undefined : t("common.optional")}>
        <PhoneField id="contact-phone" defaultCountryIso2={savedPhone?.countryIso2} defaultNational={savedPhone?.national} onChange={(v) => setPhone(v?.e164 ?? null)} onInvalidChange={setPhoneInvalid} compact />
      </LabeledField>
      <LabeledField label={t("showroomSettings.contact.whatsapp")} htmlFor="contact-whatsapp" optional={t("common.optional")}>
        <PhoneField id="contact-whatsapp" defaultCountryIso2={savedWhatsapp?.countryIso2} defaultNational={savedWhatsapp?.national} onChange={(v) => setWhatsapp(v?.e164 ?? null)} onInvalidChange={setWhatsappInvalid} compact />
      </LabeledField>
      <LabeledField label={t("showroomSettings.contact.email")} htmlFor="contact-email" optional={t("common.optional")}>
        <Input id="contact-email" name="email" type="email" dir="ltr" autoComplete="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
      </LabeledField>

      <fieldset className="flex flex-col gap-sm border-t border-strong pt-md">
        <legend className="text-label font-medium text-fg-secondary">{t("showroomSettings.contact.visibility")}</legend>
        <p className="text-label text-fg-muted">{t("showroomSettings.contact.visibilityHint")}</p>
        <Checkbox id="contact-show-phone" name="showPhone" checked={showPhone && Boolean(phone)} onChange={setShowPhone}>{t("showroomSettings.contact.showPhone")}</Checkbox>
        <Checkbox id="contact-show-whatsapp" name="showWhatsapp" checked={showWhatsapp && Boolean(whatsapp)} onChange={setShowWhatsapp}>{t("showroomSettings.contact.showWhatsapp")}</Checkbox>
        <Checkbox id="contact-show-email" name="showEmail" checked={showEmail && Boolean(email.trim())} onChange={setShowEmail}>{t("showroomSettings.contact.showEmail")}</Checkbox>
      </fieldset>

      {state.ok ? <InlineSuccess>{t("showroomSettings.contact.saved")}</InlineSuccess> : null}
      {!state.ok && state.code ? <InlineError>{t(state.code)}</InlineError> : null}
      <div className="flex items-center gap-sm">
        <Button type="submit" size="sm" disabled={blocked} data-testid="organization-contact-save">
          {pending ? t("showroomSettings.contact.saving") : t("showroomSettings.contact.save")}
        </Button>
        {phoneRequired ? <p className="text-label text-fg-muted">{t("showroomSettings.contact.phoneRequired")}</p> : null}
      </div>
    </form>
  );
}

function ReadOnly({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-label text-fg-muted">{label}</dt>
      <dd className="text-body text-fg"><span dir="ltr">{value ?? "—"}</span></dd>
    </div>
  );
}
