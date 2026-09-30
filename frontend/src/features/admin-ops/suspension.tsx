import type { Locale } from "@/lib/i18n/locales";
import type { getMessages } from "@/lib/i18n/translate";
import { formatAdminDateTime } from "@/lib/ui/format";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LabeledField, Textarea } from "@/components/ui/controls";
import { AlertIcon, CheckIcon } from "@/components/ui/icons";
import { restoreSubjectAction, suspendSubjectAction } from "@/server/actions/admin-operations";
import type { Suspension } from "@/features/admin-preview/operations-mappers";

type Messages = ReturnType<typeof getMessages>;
type Subject = "user" | "organization";

/**
 * Admin Core 1B-B — the live Suspend / Restore control. A real mutation
 * through `suspendSubjectAction` / `restoreSubjectAction` → the self-guarding
 * RPC (permission, platform scope, rank / self / last-Super-Admin rules,
 * idempotency, audit). Callers render it only for holders of users.suspend /
 * organizations.suspend — presentation only; the RPC is the boundary.
 */
export function SuspensionAction({
  m,
  subjectType,
  subjectId,
  suspended,
  compact = false,
}: {
  m: Messages;
  subjectType: Subject;
  subjectId: string;
  suspended: boolean;
  /** Icon trigger for a directory row instead of a labelled button. */
  compact?: boolean;
}) {
  const t = m.admin.preview.ops.suspend;
  const hidden = (
    <>
      <input type="hidden" name="subjectType" value={subjectType} />
      <input type="hidden" name="subjectId" value={subjectId} />
    </>
  );
  const fieldId = `${suspended ? "restore" : "suspend"}-reason-${subjectId}`;

  if (suspended) {
    return (
      <ConfirmDialog
        trigger={t.restore}
        triggerVariant="outline"
        triggerIcon={compact ? <CheckIcon size={16} /> : undefined}
        triggerTone="success"
        title={t.restoreTitle}
        body={subjectType === "user" ? t.restoreUserBody : t.restoreOrgBody}
        confirmLabel={t.restore}
        confirmVariant="accent"
        formAction={restoreSubjectAction}
      >
        {hidden}
        <LabeledField label={t.restoreReasonLabel} htmlFor={fieldId}>
          <Textarea id={fieldId} name="reason" rows={2} maxLength={500} />
        </LabeledField>
      </ConfirmDialog>
    );
  }
  return (
    <ConfirmDialog
      trigger={t.confirm}
      triggerVariant="danger"
      triggerIcon={compact ? <AlertIcon size={16} /> : undefined}
      triggerTone="danger"
      title={subjectType === "user" ? t.userTitle : t.orgTitle}
      body={subjectType === "user" ? t.userBody : t.orgBody}
      confirmLabel={t.confirm}
      confirmVariant="danger"
      formAction={suspendSubjectAction}
    >
      {hidden}
      <LabeledField label={t.reasonLabel} htmlFor={fieldId}>
        <Textarea id={fieldId} name="reason" rows={3} maxLength={500} placeholder={t.reasonPlaceholder} required />
      </LabeledField>
    </ConfirmDialog>
  );
}

/** The suspension notice on a detail page: who suspended, when and why (internal). */
export function SuspensionBanner({
  m,
  locale,
  subjectType,
  suspension,
}: {
  m: Messages;
  locale: Locale;
  subjectType: Subject;
  suspension: Suspension | null;
}) {
  const t = m.admin.preview.ops.suspend;
  return (
    <div role="status" className="flex items-start gap-3 rounded-md border border-danger/40 bg-danger/10 px-md py-3">
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-danger">
        <AlertIcon size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-body-lg font-medium text-fg">{subjectType === "user" ? t.bannerUser : t.bannerOrg}</p>
        {suspension ? (
          <>
            <p className="mt-0.5 text-label text-fg-secondary">
              {t.since
                .replace("{date}", formatAdminDateTime(suspension.suspendedAt, locale))
                .replace("{name}", suspension.suspendedBy?.displayName || m.admin.users.unnamed)}
            </p>
            <p className="mt-1 text-body text-fg-secondary">
              <span className="font-medium text-fg">{t.reason}:</span> {suspension.reason}
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
