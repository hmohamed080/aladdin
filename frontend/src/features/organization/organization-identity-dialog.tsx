"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LabeledField, Input, Select } from "@/components/ui/controls";
import { TIMEZONE_OPTIONS } from "@/lib/workspace/timezone-options";
import { updateOrganizationI18nAction } from "@/server/actions/organization-i18n";
import type { Messages } from "@/lib/i18n/messages/en";

/**
 * Edit dialog for the organization's own bilingual trading name + timezone —
 * the RPC write path `organization_update_i18n` adds. Lives on the existing
 * `/b2b/settings` Business card rather than a new page: that card is the
 * organization's own settled home in this product's IA, and its own doc
 * comment already anticipates fields becoming editable "through an existing
 * trusted path" once a real RPC exists.
 */
export function OrganizationIdentityDialog({
  m,
  orgId,
  nameAr,
  nameEn,
  timezone,
}: {
  m: Messages;
  orgId: string;
  nameAr: string | null;
  nameEn: string | null;
  timezone: string | null;
}) {
  return (
    <ConfirmDialog
      trigger={m.common.edit}
      triggerVariant="outline"
      title={m.settings.editOrgTitle}
      confirmLabel={m.common.saveChanges}
      confirmVariant="accent"
      formAction={updateOrganizationI18nAction}
    >
      <input type="hidden" name="orgId" value={orgId} />
      <p className="text-body text-fg-secondary">{m.settings.editOrgHelp}</p>

      <LabeledField label={m.settings.field.nameAr} htmlFor="org-name-ar" optional={m.common.optional}>
        <Input id="org-name-ar" name="nameAr" defaultValue={nameAr ?? ""} dir="rtl" maxLength={120} />
      </LabeledField>

      <LabeledField label={m.settings.field.nameEn} htmlFor="org-name-en" optional={m.common.optional}>
        <Input id="org-name-en" name="nameEn" defaultValue={nameEn ?? ""} dir="ltr" maxLength={120} />
      </LabeledField>

      <LabeledField
        label={m.settings.field.timezone}
        htmlFor="org-timezone"
        hint={m.settings.timezoneHint}
        optional={m.common.optional}
      >
        <Select id="org-timezone" name="timezone" defaultValue={timezone ?? ""}>
          <option value="">{m.settings.timezoneUnset}</option>
          {TIMEZONE_OPTIONS.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </Select>
      </LabeledField>
    </ConfirmDialog>
  );
}
