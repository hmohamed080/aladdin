"use client";

import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { updateFollowUpAction, type FormState } from "@/server/actions/sales-forms";
import { Card } from "@/components/ui/primitives";
import { Input, Textarea, Select, LabeledField, SubmitButton } from "@/components/ui/controls";
import { PRIORITIES } from "@/lib/ui/format";
import type { FollowUpRow } from "@/server/queries/sales";

const initial: FormState = { ok: false };

/** ISO timestamp -> value for <input type="datetime-local"> in the user's local time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Edit an OPEN follow-up (title/description/due/priority) via `update_follow_up`.
 * The server rejects a non-open follow-up (`states.followUpNotOpen`); this form
 * is only reached for open tasks, but the guard is enforced server-side too.
 */
export function FollowUpEditForm({ followUp }: { followUp: FollowUpRow }) {
  const { t } = useI18n();
  const [state, action] = useActionState(updateFollowUpAction, initial);
  const fe = state.fieldErrors ?? {};

  return (
    <Card className="max-w-2xl">
      {state.code && !state.ok ? (
        <p role="alert" className="mb-md rounded-sm border border-danger/40 bg-danger/10 px-md py-2 text-body text-danger">
          {t(state.code)}
        </p>
      ) : null}

      <form action={action} className="grid gap-md tablet:grid-cols-2" noValidate>
        <input type="hidden" name="followUpId" value={followUp.id} />
        {followUp.lead_id ? <input type="hidden" name="leadId" value={followUp.lead_id} /> : null}
        {followUp.customer_id ? <input type="hidden" name="customerId" value={followUp.customer_id} /> : null}

        <div className="tablet:col-span-2">
          <LabeledField label={t("followUps.titleField")} htmlFor="title" error={fe.title ? t(fe.title) : undefined}>
            <Input id="title" name="title" required maxLength={200} defaultValue={followUp.title} aria-invalid={fe.title ? true : undefined} />
          </LabeledField>
        </div>

        <LabeledField label={t("followUps.dueAt")} htmlFor="dueAt" optional={t("common.optional")}>
          <Input id="dueAt" name="dueAt" type="datetime-local" defaultValue={toLocalInput(followUp.due_at)} />
        </LabeledField>

        <LabeledField label={t("followUps.priority")} htmlFor="priority">
          <Select id="priority" name="priority" defaultValue={followUp.priority}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{t(`priority.${p}`)}</option>
            ))}
          </Select>
        </LabeledField>

        <div className="tablet:col-span-2">
          <LabeledField label={t("followUps.description")} htmlFor="description" optional={t("common.optional")}>
            <Textarea id="description" name="description" maxLength={2000} defaultValue={followUp.description ?? ""} />
          </LabeledField>
        </div>

        <div className="tablet:col-span-2">
          <SubmitButton pendingLabel={t("common.saving")}>{t("common.saveChanges")}</SubmitButton>
        </div>
      </form>
    </Card>
  );
}
