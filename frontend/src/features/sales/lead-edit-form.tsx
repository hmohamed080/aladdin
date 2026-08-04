"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { updateLeadDetailsAction, type FormState } from "@/server/actions/sales-forms";
import { Card } from "@/components/ui/primitives";
import { Input, Select, LabeledField, SubmitButton } from "@/components/ui/controls";
import { PRIORITIES } from "@/lib/ui/format";
import type { LeadRow } from "@/server/queries/sales";

const initial: FormState = { ok: false };

/**
 * Edit NON-lifecycle lead details (title, priority). Carries the current
 * `version`; a stale submit returns `leads.conflict`, on which we refresh the
 * server data so the form re-renders with the newer version and the user retries
 * against current state (their typed values remain until the refresh completes).
 */
export function LeadEditForm({ lead }: { lead: LeadRow }) {
  const { t } = useI18n();
  const router = useRouter();
  const [state, action] = useActionState(
    async (prev: FormState, fd: FormData) => {
      const res = await updateLeadDetailsAction(prev, fd);
      if (res.code === "leads.conflict") router.refresh();
      return res;
    },
    initial,
  );
  const fe = state.fieldErrors ?? {};

  return (
    <Card className="max-w-2xl">
      {state.code && !state.ok ? (
        <p role="alert" className="mb-md rounded-sm border border-danger/40 bg-danger/10 px-md py-2 text-body text-danger">
          {t(state.code)}
        </p>
      ) : null}

      <form action={action} className="grid gap-md tablet:grid-cols-2" noValidate>
        <input type="hidden" name="leadId" value={lead.id} />
        <input type="hidden" name="version" value={lead.version} />

        <div className="tablet:col-span-2">
          <LabeledField label={t("leads.leadTitle")} htmlFor="title" error={fe.title ? t(fe.title) : undefined}>
            <Input id="title" name="title" required maxLength={200} defaultValue={lead.title} aria-invalid={fe.title ? true : undefined} />
          </LabeledField>
        </div>

        <LabeledField label={t("leads.priority")} htmlFor="priority">
          <Select id="priority" name="priority" defaultValue={lead.priority}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{t(`priority.${p}`)}</option>
            ))}
          </Select>
        </LabeledField>

        <div className="tablet:col-span-2 flex flex-col gap-1">
          <SubmitButton pendingLabel={t("common.saving")}>{t("common.saveChanges")}</SubmitButton>
          <p className="text-label text-fg-muted">{t("leads.editHint")}</p>
        </div>
      </form>
    </Card>
  );
}
