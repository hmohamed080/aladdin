"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { transitionLeadAction, assignLeadAction, type FormState } from "@/server/actions/sales-forms";
import { Card } from "@/components/ui/primitives";
import { Select, Textarea, SubmitButton, LabeledField } from "@/components/ui/controls";
import { LEAD_STAGES } from "@/lib/ui/format";

const initial: FormState = { ok: false };

/**
 * Lead lifecycle controls. Every mutation carries the current `version` for
 * optimistic concurrency. On a stale-version conflict (`leads.conflict`) we show
 * the message and refresh the server data so the caller sees the current state;
 * their in-progress selection stays in the local form until they retry.
 */
export function LeadActions({
  leadId,
  version,
  status,
  stage,
  canAssign,
  members,
}: {
  leadId: string;
  version: number;
  status: string;
  stage: string;
  canAssign: boolean;
  members: { membershipId: string; displayName: string }[];
}) {
  const { t } = useI18n();
  const router = useRouter();

  const [transState, transAction] = useActionState(
    async (prev: FormState, fd: FormData) => {
      const res = await transitionLeadAction(prev, fd);
      if (res.ok || res.code === "leads.conflict") router.refresh();
      return res;
    },
    initial,
  );
  const [assignState, assignAction] = useActionState(
    async (prev: FormState, fd: FormData) => {
      const res = await assignLeadAction(prev, fd);
      if (res.ok || res.code === "leads.conflict") router.refresh();
      return res;
    },
    initial,
  );

  const [showLost, setShowLost] = useState(false);
  const isActive = status === "active";
  const isClosed = status === "won" || status === "lost";

  const banner = (s: FormState) =>
    s.code ? (
      <p
        role={s.ok ? "status" : "alert"}
        className={`mb-md rounded-sm px-md py-2 text-body ${s.ok ? "border border-success/40 bg-success/10 text-success" : "border border-warning/40 bg-warning/10 text-warning"}`}
      >
        {t(s.code)}
      </p>
    ) : null;

  return (
    <Card className="flex flex-col gap-md">
      {banner(transState)}
      {banner(assignState)}

      {isActive ? (
        <>
          {/* Stage change */}
          <form action={transAction} className="flex flex-col gap-sm">
            <input type="hidden" name="leadId" value={leadId} />
            <input type="hidden" name="version" value={version} />
            <LabeledField label={t("leads.changeStage")} htmlFor="stage">
              <Select id="stage" name="stage" defaultValue={stage}>
                {LEAD_STAGES.map((s) => (
                  <option key={s} value={s}>{t(`leads.stages.${s}`)}</option>
                ))}
              </Select>
            </LabeledField>
            <SubmitButton variant="outline" pendingLabel={t("common.saving")}>{t("common.save")}</SubmitButton>
          </form>

          <div className="flex flex-wrap gap-sm">
            {/* Mark won */}
            <form action={transAction}>
              <input type="hidden" name="leadId" value={leadId} />
              <input type="hidden" name="version" value={version} />
              <input type="hidden" name="status" value="won" />
              <SubmitButton variant="accent" pendingLabel={t("common.saving")}>{t("leads.markWon")}</SubmitButton>
            </form>
            {/* Mark lost (reveals reason) */}
            <button
              type="button"
              onClick={() => setShowLost((v) => !v)}
              className="inline-flex min-h-9 items-center rounded-sm border border-danger/50 px-md py-1.5 text-label font-medium text-danger hover:bg-danger/10"
            >
              {t("leads.markLost")}
            </button>
          </div>

          {showLost ? (
            <form action={transAction} className="flex flex-col gap-sm rounded-sm border border-danger/30 p-md">
              <input type="hidden" name="leadId" value={leadId} />
              <input type="hidden" name="version" value={version} />
              <input type="hidden" name="status" value="lost" />
              <LabeledField
                label={t("leads.lostReason")}
                htmlFor="lostReason"
                error={transState.fieldErrors?.lostReason ? t(transState.fieldErrors.lostReason) : undefined}
              >
                <Textarea id="lostReason" name="lostReason" required maxLength={2000} />
              </LabeledField>
              <SubmitButton variant="danger" pendingLabel={t("common.saving")}>{t("leads.markLost")}</SubmitButton>
            </form>
          ) : null}
        </>
      ) : null}

      {isClosed || status === "archived" ? (
        <form action={transAction}>
          <input type="hidden" name="leadId" value={leadId} />
          <input type="hidden" name="version" value={version} />
          <input type="hidden" name="status" value="active" />
          <SubmitButton variant="outline" pendingLabel={t("common.saving")}>{t("leads.reopen")}</SubmitButton>
        </form>
      ) : null}

      {isActive ? (
        <form action={transAction}>
          <input type="hidden" name="leadId" value={leadId} />
          <input type="hidden" name="version" value={version} />
          <input type="hidden" name="status" value="archived" />
          <SubmitButton variant="ghost" pendingLabel={t("common.saving")}>{t("leads.archive")}</SubmitButton>
        </form>
      ) : null}

      {/* Assign / reassign */}
      {canAssign && members.length > 0 ? (
        <form action={assignAction} className="flex flex-col gap-sm border-t pt-md">
          <input type="hidden" name="leadId" value={leadId} />
          <input type="hidden" name="version" value={version} />
          <LabeledField label={t("leads.reassign")} htmlFor="assigneeMembershipId">
            <Select id="assigneeMembershipId" name="assigneeMembershipId" required defaultValue="">
              <option value="" disabled>{t("common.unassigned")}</option>
              {members.map((mem) => (
                <option key={mem.membershipId} value={mem.membershipId}>{mem.displayName}</option>
              ))}
            </Select>
          </LabeledField>
          <SubmitButton variant="outline" pendingLabel={t("common.saving")}>{t("leads.assign")}</SubmitButton>
        </form>
      ) : null}
    </Card>
  );
}
