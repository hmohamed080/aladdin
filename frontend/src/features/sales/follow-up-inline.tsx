"use client";

import { useActionState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { createFollowUpAction, type FormState } from "@/server/actions/sales-forms";
import { Input, Select, SubmitButton, LabeledField } from "@/components/ui/controls";
import { PRIORITIES } from "@/lib/ui/format";

const initial: FormState = { ok: false };

/**
 * Compact "add follow-up" form embedded on the lead detail. Self-assigns by
 * default; assigning to another member requires sales.assign (server-enforced).
 */
export function InlineFollowUpForm({
  orgId,
  leadId,
  members,
  canAssign,
  selfMembershipId,
}: {
  orgId: string;
  leadId: string;
  members: { membershipId: string; displayName: string }[];
  canAssign: boolean;
  selfMembershipId: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action] = useActionState(async (prev: FormState, fd: FormData) => {
    const res = await createFollowUpAction(prev, fd);
    if (res.ok) router.refresh();
    return res;
  }, initial);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <details className="rounded-sm border">
      <summary className="cursor-pointer px-md py-2 text-label text-fg-secondary">+ {t("followUps.new")}</summary>
      <form ref={formRef} action={action} className="flex flex-col gap-sm border-t p-md">
        <input type="hidden" name="orgId" value={orgId} />
        <input type="hidden" name="leadId" value={leadId} />
        {state.code && !state.ok ? (
          <p role="alert" className="text-label text-danger">{t(state.code)}</p>
        ) : null}
        <LabeledField label={t("followUps.titleField")} htmlFor={`fu-title-${leadId}`} error={state.fieldErrors?.title ? t(state.fieldErrors.title) : undefined}>
          <Input id={`fu-title-${leadId}`} name="title" required maxLength={200} />
        </LabeledField>
        <div className="grid gap-sm tablet:grid-cols-2">
          <LabeledField label={t("followUps.dueAt")} htmlFor={`fu-due-${leadId}`} optional={t("common.optional")}>
            <Input id={`fu-due-${leadId}`} name="dueAt" type="datetime-local" />
          </LabeledField>
          <LabeledField label={t("followUps.priority")} htmlFor={`fu-prio-${leadId}`}>
            <Select id={`fu-prio-${leadId}`} name="priority" defaultValue="normal">
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{t(`priority.${p}`)}</option>
              ))}
            </Select>
          </LabeledField>
        </div>
        {canAssign && members.length > 0 ? (
          <LabeledField label={t("followUps.assignee")} htmlFor={`fu-assignee-${leadId}`}>
            <Select id={`fu-assignee-${leadId}`} name="assigneeMembershipId" defaultValue={selfMembershipId}>
              {members.map((mem) => (
                <option key={mem.membershipId} value={mem.membershipId}>{mem.displayName}</option>
              ))}
            </Select>
          </LabeledField>
        ) : (
          <input type="hidden" name="assigneeMembershipId" value={selfMembershipId} />
        )}
        <SubmitButton variant="outline" pendingLabel={t("common.saving")}>{t("followUps.create")}</SubmitButton>
      </form>
    </details>
  );
}
