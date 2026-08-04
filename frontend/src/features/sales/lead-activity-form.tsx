"use client";

import { useActionState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { addActivityAction, type FormState } from "@/server/actions/sales-forms";
import { Input, Select, SubmitButton } from "@/components/ui/controls";

const initial: FormState = { ok: false };

/** Inline "add activity" (note/call/meeting) row on the lead timeline. */
export function LeadActivityForm({ orgId, leadId }: { orgId: string; leadId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action] = useActionState(async (prev: FormState, fd: FormData) => {
    const res = await addActivityAction(prev, fd);
    if (res.ok) router.refresh();
    return res;
  }, initial);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-sm">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="leadId" value={leadId} />
      {state.code && !state.ok ? (
        <p role="alert" className="text-label text-danger">{t(state.code)}</p>
      ) : null}
      <div className="flex flex-wrap gap-sm">
        <label className="shrink-0">
          <span className="sr-only">{t("activities.summaryLabel")}</span>
          <Select name="activityType" defaultValue="note" aria-label={t("activities.note")}>
            <option value="note">{t("activities.note")}</option>
            <option value="call">{t("activities.call")}</option>
            <option value="meeting">{t("activities.meeting")}</option>
            <option value="follow_up">{t("activities.follow_up")}</option>
          </Select>
        </label>
        <label className="flex-1">
          <span className="sr-only">{t("activities.summaryLabel")}</span>
          <Input name="summary" required maxLength={2000} placeholder={t("activities.summaryLabel")} aria-label={t("activities.summaryLabel")} />
        </label>
        <SubmitButton variant="outline" pendingLabel={t("common.saving")}>{t("common.create")}</SubmitButton>
      </div>
    </form>
  );
}
