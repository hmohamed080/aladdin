"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LabeledField, Input, Textarea, Select } from "@/components/ui/controls";
import { TIMEZONE_OPTIONS } from "@/lib/workspace/timezone-options";
import { updateBranchI18nAction } from "@/server/actions/organization-i18n";
import type { Messages } from "@/lib/i18n/messages/en";

/**
 * Edit dialog for one branch's bilingual name/address + timezone, via
 * `branch_update_i18n`. One dialog instance per branch row on the existing
 * `/b2b/settings` Branches card, scoped by the hidden `branchId` field —
 * not a new page.
 */
export function BranchIdentityDialog({
  m,
  branchId,
  branchName,
  nameAr,
  nameEn,
  addressAr,
  addressEn,
  timezone,
}: {
  m: Messages;
  branchId: string;
  branchName: string;
  nameAr: string | null;
  nameEn: string | null;
  addressAr: string | null;
  addressEn: string | null;
  timezone: string | null;
}) {
  return (
    <ConfirmDialog
      trigger={m.common.edit}
      triggerVariant="outline"
      title={m.settings.editBranchTitle.replace("{name}", branchName)}
      confirmLabel={m.common.saveChanges}
      confirmVariant="accent"
      formAction={updateBranchI18nAction}
    >
      <input type="hidden" name="branchId" value={branchId} />
      <p className="text-body text-fg-secondary">{m.settings.editBranchHelp}</p>

      <div className="grid gap-md tablet:grid-cols-2">
        <LabeledField label={m.settings.field.nameAr} htmlFor="branch-name-ar" optional={m.common.optional}>
          <Input id="branch-name-ar" name="nameAr" defaultValue={nameAr ?? ""} dir="rtl" maxLength={120} />
        </LabeledField>
        <LabeledField label={m.settings.field.nameEn} htmlFor="branch-name-en" optional={m.common.optional}>
          <Input id="branch-name-en" name="nameEn" defaultValue={nameEn ?? ""} dir="ltr" maxLength={120} />
        </LabeledField>
      </div>

      <div className="grid gap-md tablet:grid-cols-2">
        <LabeledField label={m.settings.field.addressAr} htmlFor="branch-address-ar" optional={m.common.optional}>
          <Textarea id="branch-address-ar" name="addressAr" defaultValue={addressAr ?? ""} dir="rtl" maxLength={300} />
        </LabeledField>
        <LabeledField label={m.settings.field.addressEn} htmlFor="branch-address-en" optional={m.common.optional}>
          <Textarea id="branch-address-en" name="addressEn" defaultValue={addressEn ?? ""} dir="ltr" maxLength={300} />
        </LabeledField>
      </div>

      <LabeledField
        label={m.settings.field.timezone}
        htmlFor="branch-timezone"
        hint={m.settings.branchTimezoneHint}
        optional={m.common.optional}
      >
        <Select id="branch-timezone" name="timezone" defaultValue={timezone ?? ""}>
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
