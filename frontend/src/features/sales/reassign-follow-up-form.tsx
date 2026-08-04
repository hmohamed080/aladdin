"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { reassignFollowUpAction, type FormState } from "@/server/actions/sales-forms";
import { Card } from "@/components/ui/primitives";
import { Select, SubmitButton, LabeledField } from "@/components/ui/controls";

const initial: FormState = { ok: false };

/**
 * Reassign an open follow-up to another org member. Only shown when the caller
 * holds assignment capability; members come from the active org (already filtered
 * to active). Assignee/branch compatibility and same-org are enforced by the
 * trusted reassign_follow_up RPC. Carries the current version so a stale
 * reassignment can't clobber a newer concurrent edit.
 */
export function ReassignFollowUpForm({
  followUpId,
  version,
  currentAssigneeId,
  members,
  leadId,
  customerId,
}: {
  followUpId: string;
  version: number;
  currentAssigneeId: string | null;
  members: { membershipId: string; displayName: string }[];
  leadId?: string | null;
  customerId?: string | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [state, action] = useActionState(async (prev: FormState, fd: FormData) => {
    const res = await reassignFollowUpAction(prev, fd);
    if (res.ok || res.code === "states.staleConflict") router.refresh();
    return res;
  }, initial);

  if (members.length === 0) return null;

  return (
    <Card className="max-w-2xl">
      {state.code ? (
        <p
          role={state.ok ? "status" : "alert"}
          className={`mb-md rounded-sm px-md py-2 text-body ${state.ok ? "border border-success/40 bg-success/10 text-success" : "border border-danger/40 bg-danger/10 text-danger"}`}
        >
          {t(state.code)}
        </p>
      ) : null}
      <form action={action} className="flex flex-col gap-sm">
        <input type="hidden" name="followUpId" value={followUpId} />
        <input type="hidden" name="version" value={version} />
        {leadId ? <input type="hidden" name="leadId" value={leadId} /> : null}
        {customerId ? <input type="hidden" name="customerId" value={customerId} /> : null}
        <LabeledField label={t("followUps.assignee")} htmlFor="reassign-assignee">
          <Select id="reassign-assignee" name="assigneeMembershipId" required defaultValue={currentAssigneeId ?? ""}>
            <option value="" disabled>
              {t("common.unassigned")}
            </option>
            {members.map((mem) => (
              <option key={mem.membershipId} value={mem.membershipId}>
                {mem.displayName}
              </option>
            ))}
          </Select>
        </LabeledField>
        <SubmitButton variant="outline" pendingLabel={t("common.saving")}>
          {t("followUps.reassign")}
        </SubmitButton>
      </form>
    </Card>
  );
}
