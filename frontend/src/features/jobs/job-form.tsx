"use client";

import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { tradeLabel } from "@/lib/i18n/trade-label";
import {
  createJobAction,
  updateJobAction,
  type FormState,
} from "@/server/actions/job-forms";
import { Card, SectionTitle, InlineError } from "@/components/ui/primitives";
import { Input, Textarea, Select, LabeledField, SubmitButton } from "@/components/ui/controls";
import { readableColumnClass } from "@/components/layout/content-column";
import type { Trade } from "@/server/queries/trades";
import type { JobListRow } from "@/server/queries/jobs";

const initial: FormState = { ok: false };

/**
 * One form for creating and editing an opening.
 *
 * Two modes rather than two components, because the fields ARE the same fields:
 * a create screen and an edit screen that drift apart is how a product ends up
 * asking for something on one and not the other. `job` present means edit.
 *
 * WHAT THE FORM DOES NOT DECIDE. It disables the trade and the amount once
 * applications exist, and it renders nothing at all for a job past `open`. Both
 * are AFFORDANCES — the server refuses either change regardless, through
 * `job_update` and, underneath it, `app.jobs_offer_immutable_after_application()`.
 * The reason to disable them anyway is that inviting a change the database will
 * reject is a worse experience than not offering it: the person writes a new
 * number, presses save, and is told no.
 */
export function JobForm({
  mode,
  orgId,
  branchId,
  trades,
  job,
  applicationCount = 0,
}: {
  mode: "create" | "edit";
  orgId: string;
  branchId?: string | null;
  trades: Trade[];
  job?: JobListRow;
  applicationCount?: number;
}) {
  const { t } = useI18n();
  const [state, action] = useActionState(
    mode === "create" ? createJobAction : updateJobAction,
    initial,
  );
  const fe = state.fieldErrors ?? {};

  // O7, on screen. Once one person has applied against a stated trade and a
  // stated amount, both are frozen — every later applicant has to be bidding on
  // the same thing the first one did.
  const offerLocked = mode === "edit" && applicationCount > 0;

  // The one trade that may appear here without being in the catalog: the one
  // THIS job already holds, after the platform retired it. `loadTradeCatalog()`
  // is still active-only — the vocabulary is not widened, and no other job's
  // retired trade is reachable — but a job that already carries a value has to
  // be able to keep it, or the poster cannot correct a typo in the title.
  // `job_update` accepts exactly this one key and refuses every other inactive
  // one; without the option the select would submit blank and the whole edit
  // would be refused for a field the poster never meant to touch.
  const historicalTrade =
    mode === "edit" && job?.tradeRetired && job.tradeKey ? job.tradeKey : null;

  return (
    <form action={action} className={readableColumnClass} noValidate>
      {mode === "create" ? (
        <input type="hidden" name="orgId" value={orgId} />
      ) : (
        <>
          <input type="hidden" name="jobId" value={job!.id} />
          <input type="hidden" name="expectedVersion" value={job!.version} />
        </>
      )}
      {branchId ? <input type="hidden" name="branchId" value={branchId} /> : null}

      <div className="flex flex-col gap-lg">
        <Card>
          <SectionTitle>{t("jobs.field.title")}</SectionTitle>
          <div className="mt-md flex flex-col gap-md">
            <LabeledField
              label={t("jobs.field.title")}
              htmlFor="title"
              error={fe.title ? t(fe.title) : undefined}
            >
              <Input
                id="title"
                name="title"
                defaultValue={job?.title ?? ""}
                placeholder={t("jobs.placeholder.title")}
                maxLength={200}
              />
            </LabeledField>

            <LabeledField label={t("jobs.field.description")} htmlFor="description">
              <Textarea
                id="description"
                name="description"
                rows={5}
                defaultValue={job?.description ?? ""}
                placeholder={t("jobs.placeholder.description")}
                maxLength={2000}
              />
            </LabeledField>

            {/* The canonical taxonomy from Increment 5, read from the database.
                The VALUE is the trade key and never the uuid: ids differ per
                environment and mean nothing to a reader, and the key is what the
                RPC takes. The LABEL goes through `tradeLabel`, which is the one
                place a key becomes a word in either locale. */}
            <LabeledField
              label={t("jobs.field.trade")}
              htmlFor="tradeKey"
              error={fe.tradeKey ? t(fe.tradeKey) : undefined}
              hint={offerLocked ? t("jobs.hint.offerLocked") : undefined}
            >
              <Select
                id="tradeKey"
                name="tradeKey"
                defaultValue={job?.tradeKey ?? ""}
                disabled={offerLocked}
              >
                <option value="" disabled>
                  {t("jobs.placeholder.chooseTrade")}
                </option>
                {historicalTrade ? (
                  <option value={historicalTrade}>
                    {tradeLabel(t, historicalTrade)} · {t("jobs.hint.tradeRetired")}
                  </option>
                ) : null}
                {trades.map((tr) => (
                  <option key={tr.id} value={tr.key}>
                    {tradeLabel(t, tr.key)}
                  </option>
                ))}
              </Select>
            </LabeledField>
            {/* A disabled control submits nothing, so the value the server needs
                travels beside it. The server would refuse a CHANGE anyway; this
                just means an unrelated edit does not arrive with an empty trade. */}
            {offerLocked ? <input type="hidden" name="tradeKey" value={job?.tradeKey ?? ""} /> : null}
          </div>
        </Card>

        <Card>
          <SectionTitle>{t("jobs.field.offer")}</SectionTitle>
          <div className="mt-md grid gap-md tablet:grid-cols-2">
            <LabeledField
              label={t("jobs.field.offer")}
              htmlFor="offeredAmount"
              error={fe.offeredAmount ? t(fe.offeredAmount) : undefined}
              hint={t("jobs.hint.offer")}
            >
              {/* EGP, and no currency selector — the Pilot pins it by database
                  constraint, so offering a choice would be offering a refusal. */}
              <div className="flex items-center gap-2">
                <Input
                  id="offeredAmount"
                  name="offeredAmount"
                  type="number"
                  inputMode="decimal"
                  min="1"
                  step="0.01"
                  defaultValue={job?.offered_amount ?? ""}
                  disabled={offerLocked}
                  className="min-w-0"
                />
                <span className="shrink-0 text-label text-fg-muted">EGP</span>
              </div>
            </LabeledField>
            {offerLocked ? (
              <input type="hidden" name="offeredAmount" value={job?.offered_amount ?? ""} />
            ) : null}

            <LabeledField
              label={t("jobs.field.duration")}
              htmlFor="expectedDurationDays"
              hint={t("jobs.hint.duration")}
            >
              <Input
                id="expectedDurationDays"
                name="expectedDurationDays"
                type="number"
                inputMode="numeric"
                min="0"
                max="365"
                defaultValue={job?.expected_duration_days ?? ""}
              />
            </LabeledField>

            <LabeledField label={t("jobs.field.startsOn")} htmlFor="startsOn">
              <Input id="startsOn" name="startsOn" type="date" defaultValue={job?.starts_on ?? ""} />
            </LabeledField>

            <LabeledField
              label={t("jobs.field.endsBy")}
              htmlFor="endsBy"
              error={fe.endsBy ? t(fe.endsBy) : undefined}
            >
              <Input id="endsBy" name="endsBy" type="date" defaultValue={job?.ends_by ?? ""} />
            </LabeledField>
          </div>
        </Card>

        <Card>
          <SectionTitle>{t("jobs.field.location")}</SectionTitle>
          <div className="mt-md grid gap-md tablet:grid-cols-2">
            <LabeledField label={t("jobs.field.governorate")} htmlFor="governorate">
              <Input
                id="governorate"
                name="governorate"
                defaultValue={job?.governorate ?? ""}
                maxLength={80}
              />
            </LabeledField>
            <LabeledField label={t("jobs.field.city")} htmlFor="city">
              <Input id="city" name="city" defaultValue={job?.city ?? ""} maxLength={80} />
            </LabeledField>
            {/* Withheld from every discovery projection until the job is awarded
                (§11). The hint says so, because a person typing a street address
                into a public-looking form deserves to know who will read it. */}
            <div className="tablet:col-span-2">
              <LabeledField
                label={t("jobs.field.siteAddress")}
                htmlFor="siteAddress"
                hint={t("jobs.hint.siteAddress")}
              >
                <Input
                  id="siteAddress"
                  name="siteAddress"
                  defaultValue={job?.site_address ?? ""}
                  maxLength={300}
                />
              </LabeledField>
            </div>
          </div>
        </Card>

        <div className="flex flex-col gap-sm">
          {state.code && !state.ok ? <InlineError>{t(state.code)}</InlineError> : null}
          <div>
            <SubmitButton variant="accent" pendingLabel={t("common.saving")}>
              {mode === "create" ? t("jobs.create") : t("jobs.save")}
            </SubmitButton>
          </div>
        </div>
      </div>
    </form>
  );
}
