"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { Button, Input } from "@/components/ui/controls";
import { InlineError, InlineSuccess } from "@/components/ui/primitives";
import { saveLegalNameAction } from "@/server/actions/organization-profile";

/**
 * The legal / registered business name given at registration. It is private to the organization and Admin. A
 * manager (org.manage) corrects it in place until the identity is verified; from then on it changes only through
 * Admin review, exactly like the business name (`locked` mirrors `app.org_identity_locked`, and the RPC re-checks).
 */
export function OrganizationLegalNameField({
  orgId,
  legalName,
  canManage,
  locked,
}: {
  orgId: string;
  legalName: string | null;
  canManage: boolean;
  locked: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const saved = legalName ?? "";
  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const editable = canManage && !locked;
  const trimmed = value.trim();
  const invalid = trimmed.length < 2 || trimmed.length > 120;

  const onSave = async () => {
    setNotice(null);
    setBusy(true);
    setError(null);
    const result = await saveLegalNameAction(orgId, value);
    setBusy(false);
    if (!result.ok) {
      setError(t(`showroomSettings.legalName.error.${result.code}`));
      return;
    }
    setValue(result.value);
    setNotice(t("showroomSettings.legalName.saved"));
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-sm" data-testid="organization-legal-name-field">
      <label htmlFor="organization-legal-name" className="text-label font-medium text-fg-secondary">
        {t("showroomSettings.legalName.label")}
      </label>
      {editable ? (
        <>
          <Input
            id="organization-legal-name"
            value={value}
            maxLength={120}
            aria-invalid={invalid || undefined}
            onChange={(e) => {
              setValue(e.target.value);
              setNotice(null);
              setError(null);
            }}
          />
          {error ? <InlineError>{error}</InlineError> : null}
          {notice ? <InlineSuccess>{notice}</InlineSuccess> : null}
          <div className="flex items-center gap-sm">
            <Button type="button" size="sm" onClick={onSave} disabled={busy || invalid || trimmed === saved} data-testid="organization-legal-name-save">
              {busy ? t("showroomSettings.legalName.saving") : t("showroomSettings.legalName.save")}
            </Button>
            <p className="text-label text-fg-muted">{t("showroomSettings.legalName.hint")}</p>
          </div>
        </>
      ) : (
        <>
          <p className="text-body text-fg" data-testid="organization-legal-name-readonly"><bdi dir="auto">{saved || "—"}</bdi></p>
          {canManage && locked ? <p className="text-label text-fg-muted">{t("showroomSettings.legalName.lockedNote")}</p> : null}
        </>
      )}
    </div>
  );
}
