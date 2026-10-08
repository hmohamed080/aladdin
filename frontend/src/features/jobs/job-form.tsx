"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { specialtyLabel, tradeLabel } from "@/lib/i18n/trade-label";
import {
  createJobAction,
  updateJobAction,
  type FormState,
} from "@/server/actions/job-forms";
import { Card, SectionTitle, InlineError } from "@/components/ui/primitives";
import { Input, Textarea, LabeledField, SubmitButton } from "@/components/ui/controls";
import { ListboxSelect } from "@/components/ui/listbox";
import { CITIES_BY_GOVERNORATE, GOVERNORATE_OPTIONS } from "@/lib/installer/location-data";
import { readableColumnClass } from "@/components/layout/content-column";
import { PhoneField } from "@/components/ui/phone-field";
import { splitE164, type CanonicalPhone } from "@/lib/contact/phone";
import type { Specialty, Trade } from "@/server/queries/trades";
import type { JobListRow, JobWorkContact } from "@/server/queries/jobs";

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
  specialties = [],
  job,
  applicationCount = 0,
  contact = null,
  initialError,
}: {
  mode: "create" | "edit";
  orgId: string;
  branchId?: string | null;
  trades: Trade[];
  /** Every active specialty with its trade's key. A trade with none shows no specialty field at all. */
  specialties?: readonly Specialty[];
  job?: JobListRow;
  applicationCount?: number;
  /** The job's current work contact (edit mode). Provided by the poster for THIS job — never a profile. */
  contact?: JobWorkContact | null;
  /** A translation key to show on arrival (e.g. the job was created but its contact could not be saved). */
  initialError?: string;
}) {
  const { t, locale } = useI18n();
  const parts = splitE164(contact?.phoneE164);
  const [phone, setPhone] = useState<CanonicalPhone | null>(
    contact?.phoneE164 && parts ? { countryIso2: parts.countryIso2, national: parts.national, e164: contact.phoneE164 } : null,
  );
  const [phoneInvalid, setPhoneInvalid] = useState(false);
  const [state, action] = useActionState(
    mode === "create" ? createJobAction : updateJobAction,
    initial,
  );
  const fe = state.fieldErrors ?? {};

  // The trade, the place and the optional specialty are controlled, because each depends on the one before it: a
  // specialty belongs to ONE trade, and a city belongs to ONE governorate.
  const [tradeKey, setTradeKey] = useState(job?.tradeKey ?? "");
  const [governorateKey, setGovernorateKey] = useState(job?.governorate_key ?? "");
  const [cityKey, setCityKey] = useState(job?.city_key ?? "");
  const [specialtyId, setSpecialtyId] = useState(job?.required_specialty_id ?? "");
  const tradeSpecialties = specialties.filter((spec) => spec.tradeKey === tradeKey);
  const pick = (o: { ar: string; en: string }) => (locale === "ar" ? o.ar : o.en);
  // A job whose old free-text place never resolved keeps it unless the poster chooses a new one from the lists.
  const legacyPlace =
    mode === "edit" && job && !job.governorate_key && (job.governorate || job.city)
      ? [job.city, job.governorate].filter(Boolean).join(", ")
      : null;

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
              <ListboxSelect
                id="tradeKey"
                name="tradeKey"
                label={t("jobs.field.trade")}
                value={tradeKey}
                placeholder={t("jobs.placeholder.chooseTrade")}
                disabled={offerLocked}
                invalid={Boolean(fe.tradeKey)}
                onChange={(next) => {
                  setTradeKey(next);
                  // A specialty belongs to one trade: changing the trade clears it.
                  setSpecialtyId("");
                }}
                options={[
                  ...(historicalTrade ? [{ value: historicalTrade, label: `${tradeLabel(t, historicalTrade)} · ${t("jobs.hint.tradeRetired")}` }] : []),
                  ...trades.map((tr) => ({ value: tr.key, label: tradeLabel(t, tr.key) })),
                ]}
              />
            </LabeledField>
            {/* OPTIONAL REQUIRED SPECIALTY — shown only when this trade HAS specialties (never an empty selector). It is a
                presentation / ranking input: it never decides who may apply. */}
            {tradeSpecialties.length > 0 ? (
              <LabeledField label={t("jobs.field.requiredSpecialty")} htmlFor="requiredSpecialtyId" hint={t("jobs.hint.specialty")}>
                <ListboxSelect
                  id="requiredSpecialtyId"
                  name="requiredSpecialtyId"
                  label={t("jobs.field.requiredSpecialty")}
                  value={specialtyId}
                  onChange={setSpecialtyId}
                  options={[{ value: "", label: t("jobs.placeholder.noSpecialty") }, ...tradeSpecialties.map((spec) => ({ value: spec.id, label: specialtyLabel(t, spec.key) }))]}
                />
              </LabeledField>
            ) : null}
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
            {/* THE PLACE IS CHOSEN FROM THE CATALOGUE, never typed: governorate, then a city inside it — the same lists the
                Jobs filters and a professional's service areas use, so a job's place is one of the places somebody can be near. */}
            <LabeledField label={t("jobs.field.governorate")} htmlFor="governorateKey" error={fe.governorate ? t(fe.governorate) : undefined}>
              <ListboxSelect
                id="governorateKey"
                name="governorateKey"
                label={t("jobs.field.governorate")}
                value={governorateKey}
                placeholder={t("jobs.placeholder.chooseGovernorate")}
                invalid={Boolean(fe.governorate)}
                onChange={(next) => {
                  setGovernorateKey(next);
                  setCityKey("");
                }}
                options={GOVERNORATE_OPTIONS.map((o) => ({ value: o.value, label: pick(o) }))}
              />
            </LabeledField>
            <LabeledField label={t("jobs.field.city")} htmlFor="cityKey" error={fe.city ? t(fe.city) : undefined}>
              <ListboxSelect
                id="cityKey"
                name="cityKey"
                label={t("jobs.field.city")}
                value={cityKey}
                placeholder={t("jobs.placeholder.chooseCity")}
                disabled={!governorateKey}
                invalid={Boolean(fe.city)}
                onChange={setCityKey}
                options={(CITIES_BY_GOVERNORATE[governorateKey] ?? []).map((o) => ({ value: o.value, label: pick(o) }))}
              />
            </LabeledField>
            {legacyPlace ? (
              <div className="tablet:col-span-2">
                <p className="text-label text-fg-muted">{t("jobs.hint.legacyLocation", { place: legacyPlace })}</p>
                {!governorateKey ? <input type="hidden" name="keepLegacyLocation" value="1" /> : null}
              </div>
            ) : null}
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

        <Card>
          <SectionTitle>{t("jobs.field.workContact")}</SectionTitle>
          <p className="mt-xs text-label text-fg-muted">{t("jobs.hint.workContact")}</p>
          <div className="mt-md grid gap-md tablet:grid-cols-2">
            <div className="tablet:col-span-2">
              <LabeledField label={t("jobs.field.contactName")} htmlFor="contactName">
                <Input id="contactName" name="contactName" defaultValue={contact?.name ?? ""} maxLength={120} autoComplete="off" />
              </LabeledField>
            </div>
            {/* The number is the point of this field: it takes the full row, with a narrow country picker beside it. */}
            <div className="tablet:col-span-2">
              <LabeledField
                label={t("jobs.field.contactPhone")}
                htmlFor="contactPhone-national"
                error={fe.contactPhone ? t(fe.contactPhone) : undefined}
              >
                <PhoneField
                  id="contactPhone-national"
                  compact
                  defaultCountryIso2={parts?.countryIso2 ?? null}
                  defaultNational={parts?.national ?? null}
                  onChange={setPhone}
                  onInvalidChange={setPhoneInvalid}
                />
              </LabeledField>
            </div>
            <input type="hidden" name="contactPhone" value={phone?.e164 ?? ""} />
            {phoneInvalid ? <input type="hidden" name="contactPhoneInvalid" value="1" /> : null}
            <div className="tablet:col-span-2">
              <LabeledField
                label={t("jobs.field.contactEmail")}
                htmlFor="contactEmail"
                error={fe.contactEmail ? t(fe.contactEmail) : undefined}
              >
                <Input
                  id="contactEmail"
                  name="contactEmail"
                  type="email"
                  dir="ltr"
                  defaultValue={contact?.email ?? ""}
                  maxLength={254}
                  autoComplete="off"
                />
              </LabeledField>
            </div>
          </div>
        </Card>

        <div className="flex flex-col gap-sm">
          {initialError && !state.code ? <InlineError>{t(initialError)}</InlineError> : null}
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
