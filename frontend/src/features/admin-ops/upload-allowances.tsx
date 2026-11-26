"use client";

import { useState, useTransition } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Button, Input, SubmitButton } from "@/components/ui/controls";
import { Card, SectionTitle } from "@/components/ui/primitives";
import type { UploadExemption, UploadLimits, UploadSubject } from "@/lib/media/upload-allowances";
import type { FormState } from "@/server/actions/sales-forms";
import {
  addUploadExemptionAction, removeUploadExemptionAction, saveUploadAllowancesAction, searchUploadSubjectsAction,
} from "@/server/actions/upload-allowances";
import { useKeptFormAction } from "./use-kept-form-action";

/**
 * Upload allowances (per hour, storage) and the exempt accounts (ADR-0032). Presentation only: the database re-checks the
 * permission, the ranges and the reason on every change.
 */
export function UploadAllowances({ data, canManage }: { data: UploadLimits; canManage: boolean }) {
  const { t } = useI18n();
  return (
    <>
      <Card>
        <SectionTitle>{t("mediaLimits.allowances.title")}</SectionTitle>
        <p className="mt-sm text-label text-fg-secondary">{t("mediaLimits.allowances.intro")}</p>
        {canManage ? <AllowanceForm data={data} /> : (
          <dl className="mt-md grid gap-sm text-body text-fg">
            {([["uploads", data.hourlyUploads], ["attempts", data.hourlyAttempts], ["quota", data.storageQuotaMb]] as const).map(([name, value]) => (
              <div key={name} className="flex flex-wrap justify-between gap-md"><dt>{t(`mediaLimits.allowances.${name}`)}</dt><dd dir="ltr">{value}</dd></div>
            ))}
          </dl>
        )}
      </Card>
      <Card>
        <SectionTitle>{t("mediaLimits.allowances.exemptionsTitle")}</SectionTitle>
        <p className="mt-sm text-label text-fg-secondary">{t("mediaLimits.allowances.exemptionsIntro")}</p>
        {data.exemptions.length === 0 ? <p className="mt-md text-body text-fg-muted">{t("mediaLimits.allowances.none")}</p> : (
          <ul className="mt-md flex flex-col" data-testid="upload-exemptions">
            {data.exemptions.map((e) => <ExemptionRow key={e.id} exemption={e} canManage={canManage} />)}
          </ul>
        )}
        {canManage ? <AddExemption /> : null}
      </Card>
    </>
  );
}

function Message({ state }: { state: FormState }) {
  const { t } = useI18n();
  if (!state.code) return null;
  return <p role="status" className={`md:col-span-full ${state.ok ? "text-body text-success" : "text-body text-danger"}`}>{t(state.code)}</p>;
}

function Reason({ id, value }: { id: string; value?: string }) {
  const { t } = useI18n();
  return (
    <div>
      <label htmlFor={id} className="sr-only">{t("mediaLimits.columns.reason")}</label>
      <Input id={id} name="reason" required minLength={3} maxLength={500} dir="auto" placeholder={t("mediaLimits.columns.reason")} defaultValue={value} />
    </div>
  );
}

function AllowanceForm({ data }: { data: UploadLimits }) {
  const { t } = useI18n();
  const { state, formAction, valueOf } = useKeptFormAction(saveUploadAllowancesAction, ["uploads", "attempts", "quota", "reason"]);
  const saved = { uploads: data.hourlyUploads, attempts: data.hourlyAttempts, quota: data.storageQuotaMb };
  return (
    <form action={formAction} className="mt-md grid items-end gap-md md:grid-cols-3">
      {(["uploads", "attempts", "quota"] as const).map((name) => (
        <label key={name} htmlFor={`upload-${name}`} className="grid gap-1 text-label text-fg-secondary">
          {t(`mediaLimits.allowances.${name}`)}
          <Input id={`upload-${name}`} key={saved[name]} name={name} inputMode="numeric" dir="ltr" required pattern="[0-9]{1,6}" defaultValue={valueOf(name, String(saved[name]))} />
        </label>
      ))}
      <div className="md:col-span-2"><Reason id="upload-allowances-reason" value={valueOf("reason")} /></div>
      <SubmitButton pendingLabel={t("mediaLimits.saving")}>{t("mediaLimits.allowances.save")}</SubmitButton>
      <Message state={state} />
    </form>
  );
}

function ExemptionRow({ exemption, canManage }: { exemption: UploadExemption; canManage: boolean }) {
  const { t } = useI18n();
  const { state, formAction, valueOf } = useKeptFormAction(removeUploadExemptionAction, ["reason"]);
  return (
    <li className="grid items-end gap-md border-b border-strong py-md md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto]">
      <div>
        <p className="text-body font-medium text-fg" dir="auto">{exemption.label}</p>
        <p className="text-label text-fg-muted" dir="auto">{t(`mediaLimits.allowances.${exemption.subjectType}`)} · {exemption.reason}</p>
      </div>
      {canManage ? (
        <form action={formAction} className="contents">
          <input type="hidden" name="id" value={exemption.id} />
          <Reason id={`remove-${exemption.id}`} value={valueOf("reason")} />
          <SubmitButton pendingLabel={t("mediaLimits.saving")}>{t("mediaLimits.allowances.remove")}</SubmitButton>
          <Message state={state} />
        </form>
      ) : null}
    </li>
  );
}

function AddExemption() {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [subjects, setSubjects] = useState<UploadSubject[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, start] = useTransition();
  const { state, formAction, valueOf } = useKeptFormAction(addUploadExemptionAction, ["subject", "reason"]);

  const search = () => start(async () => {
    setSearchError(null);
    const r = await searchUploadSubjectsAction(query);
    if (r.ok) setSubjects(r.subjects);
    else { setSubjects(null); setSearchError(r.code); }
  });

  return (
    <div className="mt-lg grid gap-md">
      <form className="grid items-end gap-md md:grid-cols-[minmax(0,1fr)_auto]" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <label htmlFor="exempt-search" className="grid gap-1 text-label text-fg-secondary">
          {t("mediaLimits.allowances.searchLabel")}
          <Input id="exempt-search" value={query} onChange={(e) => setQuery(e.target.value)} dir="auto" required minLength={2} maxLength={200} placeholder={t("mediaLimits.allowances.searchHint")} />
        </label>
        <Button type="submit" variant="outline" disabled={searching}>{t("mediaLimits.allowances.search")}</Button>
      </form>
      {searchError ? <p role="alert" className="text-body text-danger">{t(searchError)}</p> : null}
      {subjects && subjects.length === 0 ? <p className="text-body text-fg-muted">{t("mediaLimits.allowances.noMatch")}</p> : null}
      {subjects && subjects.length > 0 ? (
        <form action={formAction} className="grid items-end gap-md">
          <fieldset className="grid gap-sm">
            <legend className="text-label text-fg-secondary">{t("mediaLimits.allowances.pick")}</legend>
            {subjects.map((s) => (
              <label key={`${s.type}:${s.id}`} className="flex items-center gap-sm text-body text-fg">
                <input type="radio" name="subject" value={`${s.type}:${s.id}`} defaultChecked={valueOf("subject") === `${s.type}:${s.id}`} />
                <span dir="auto">{s.label}</span>
                <span className="text-label text-fg-muted">{t(`mediaLimits.allowances.${s.type}`)} · <span dir="ltr">{[s.detail, s.id.slice(0, 8)].filter(Boolean).join(" · ")}</span></span>
              </label>
            ))}
          </fieldset>
          <Reason id="exempt-reason" value={valueOf("reason")} />
          <SubmitButton pendingLabel={t("mediaLimits.saving")}>{t("mediaLimits.allowances.add")}</SubmitButton>
          <Message state={state} />
        </form>
      ) : <Message state={state} />}
    </div>
  );
}
