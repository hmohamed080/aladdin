"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { transitionLeadAction, assignLeadAction, type FormState } from "@/server/actions/sales-forms";
import { Card } from "@/components/ui/primitives";
import { Select, Textarea, SubmitButton, LabeledField } from "@/components/ui/controls";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LEAD_STAGES } from "@/lib/ui/format";

const initial: FormState = { ok: false };

/**
 * Lead lifecycle controls. Every mutation carries the current `version` for
 * optimistic concurrency. Terminal actions (Mark Won / Mark Lost / Archive) go
 * through an accessible ConfirmDialog; Mark Lost's required reason lives inside
 * the confirmation and survives a validation or concurrency error (the dialog
 * stays open and the field keeps its value). Stage change, reopen, and assign
 * refresh on success/conflict.
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
  // Controlled so the required reason survives a validation/concurrency error
  // (React resets the uncontrolled form after a Server-Action submit).
  const [lostReason, setLostReason] = useState("");

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

  const idAndVersion = (
    <>
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="version" value={version} />
    </>
  );

  return (
    <Card className="flex flex-col gap-md">
      {banner(assignState)}

      {isActive ? (
        <>
          {/* Stage change */}
          <form action={transAction} className="flex flex-col gap-sm">
            {idAndVersion}
            <LabeledField label={t("leads.changeStage")} htmlFor="stage">
              <Select id="stage" name="stage" defaultValue={stage}>
                {LEAD_STAGES.map((s) => (
                  <option key={s} value={s}>{t(`leads.stages.${s}`)}</option>
                ))}
              </Select>
            </LabeledField>
            <SubmitButton variant="outline" pendingLabel={t("common.saving")}>{t("common.save")}</SubmitButton>
          </form>
          {banner(transState)}

          {/* Terminal actions — each behind an explicit confirmation. */}
          <div className="flex flex-wrap gap-sm">
            <ConfirmDialog
              trigger={t("leads.markWon")}
              triggerVariant="accent"
              confirmVariant="accent"
              title={t("leads.markWon")}
              body={t("confirm.markWonBody")}
              confirmLabel={t("leads.markWon")}
              formAction={transitionLeadAction}
            >
              {idAndVersion}
              <input type="hidden" name="status" value="won" />
            </ConfirmDialog>

            <ConfirmDialog
              trigger={t("leads.markLost")}
              triggerVariant="danger"
              confirmVariant="danger"
              title={t("confirm.markLostTitle")}
              body={t("confirm.markLostBody")}
              confirmLabel={t("leads.markLost")}
              formAction={transitionLeadAction}
            >
              {(s: FormState) => (
                <>
                  {idAndVersion}
                  <input type="hidden" name="status" value="lost" />
                  <LabeledField
                    label={t("leads.lostReason")}
                    htmlFor="lostReason"
                    error={s.fieldErrors?.lostReason ? t(s.fieldErrors.lostReason) : undefined}
                  >
                    <Textarea
                      id="lostReason"
                      name="lostReason"
                      required
                      maxLength={2000}
                      value={lostReason}
                      onChange={(e) => setLostReason(e.target.value)}
                      aria-invalid={s.fieldErrors?.lostReason ? true : undefined}
                    />
                  </LabeledField>
                </>
              )}
            </ConfirmDialog>

            <ConfirmDialog
              trigger={t("leads.archive")}
              triggerVariant="ghost"
              confirmVariant="danger"
              title={t("confirm.archiveLeadTitle")}
              body={t("confirm.archiveLeadBody")}
              confirmLabel={t("leads.archive")}
              formAction={transitionLeadAction}
            >
              {idAndVersion}
              <input type="hidden" name="status" value="archived" />
            </ConfirmDialog>
          </div>
        </>
      ) : null}

      {isClosed || status === "archived" ? (
        <form action={transAction}>
          {idAndVersion}
          <input type="hidden" name="status" value="active" />
          <SubmitButton variant="outline" pendingLabel={t("common.saving")}>{t("leads.reopen")}</SubmitButton>
        </form>
      ) : null}

      {/* Assign / reassign */}
      {canAssign && members.length > 0 ? (
        <form action={assignAction} className="flex flex-col gap-sm border-t pt-md">
          {idAndVersion}
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
