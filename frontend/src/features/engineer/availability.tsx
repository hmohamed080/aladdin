"use client";
import { useActionState, useState, useTransition, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/context";
import { InlineError } from "@/components/ui/primitives";
import { Input, LabeledField, SubmitButton, Button } from "@/components/ui/controls";
import { AlertIcon, CalendarCheckIcon, CalendarIcon, PlusIcon, TrashIcon, UserIcon } from "@/components/ui/icons";
import { AvailabilityControl } from "@/features/profile/availability-control";
import type { Availability } from "@/server/queries/personal-home";
import { saveUnavailablePeriod, deleteUnavailablePeriod, type UnavailablePeriod } from "@/server/actions/unavailable-periods";
import { formatDate } from "@/lib/ui/format";

/** One framed panel: round icon + title/hint header, then the body. */
function Panel({ icon, title, hint, children }: { icon: ReactNode; title: string; hint: string; children: ReactNode }) {
  return (
    <section className="engineer-avail-panel">
      <header className="engineer-avail-panel-head">
        <span className="engineer-avail-icon" aria-hidden="true">{icon}</span>
        <div className="min-w-0">
          <h3 className="engineer-avail-title">{title}</h3>
          <p className="engineer-avail-hint">{hint}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="engineer-avail-note"><AlertIcon size={20} aria-hidden="true" /><span>{children}</span></p>;
}

export function EngineerAvailability({ availability, periods }: { availability: Availability; periods: UnavailablePeriod[] }) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const disabled = availability.state !== "available";
  const [state, save] = useActionState(saveUnavailablePeriod, { ok: true });
  const [openEnded, setOpenEnded] = useState(false);
  const [removing, startRemoving] = useTransition();
  const [failed, setFailed] = useState(false);
  return <div className="engineer-avail space-y-md">
    <Panel icon={<UserIcon size={22} />} title={ar ? "حالتك الحالية" : "Your current status"} hint={ar ? "تُعرض هذه الحالة للآخرين وتساعدهم في اختيار المحترف المناسب لمشروعهم." : "Your status helps people find the right professional for their project."}>
      <AvailabilityControl availability={availability} variant="cards" />
    </Panel>
    <fieldset disabled={disabled} className="engineer-avail-fieldset min-w-0 space-y-md" data-disabled={disabled}>
      <Panel icon={<CalendarIcon size={22} />} title={ar ? "موعد الجاهزية" : "When you can start"} hint={ar ? "اختر متى يمكنك البدء في مشروع جديد." : "Choose when you can start a new project."}>
        <div id="engineer-availability-slot" />
        {disabled && <Note>{ar ? "تصبح خيارات موعد الجاهزية متاحة بعد تغيير حالتك إلى متاح للعمل." : "Mark yourself available to choose when you can start."}</Note>}
      </Panel>
      <Panel icon={<CalendarIcon size={22} />} title={ar ? "فترات عدم التوفر (اختياري)" : "Unavailable periods (optional)"} hint={ar ? "إذا كانت لديك إجازة أو فترة مشغولة، سجّلها هنا لتبقى محفوظة في حسابك." : "Record holidays or busy periods here; they are saved to your account."}>
        {periods.length > 0 && <ul className="space-y-sm">{periods.map(period => <li key={period.id} className="engineer-avail-period">
          <CalendarCheckIcon size={22} aria-hidden="true" />
          <span className="min-w-0 flex-1">{ar ? "من" : "From"} {formatDate(period.from, locale)} {period.to ? <>{ar ? "إلى" : "to"} {formatDate(period.to, locale)}</> : <>· {ar ? "بدون تاريخ انتهاء" : "No end date"}</>}</span>
          <Button variant="outline" size="sm" className="engineer-avail-remove" disabled={removing} aria-label={ar ? "إزالة الفترة" : "Remove period"} onClick={() => startRemoving(async () => { setFailed(!(await deleteUnavailablePeriod(period.id)).ok); })}><TrashIcon size={18} /></Button>
        </li>)}</ul>}
        <form action={save} className="engineer-avail-form">
          <LabeledField label={ar ? "من" : "From"} htmlFor="unavailable-from"><Input id="unavailable-from" name="from" type="date" required /></LabeledField>
          <LabeledField label={ar ? "إلى" : "To"} htmlFor="unavailable-to"><Input id="unavailable-to" name="to" type="date" required={!openEnded} disabled={disabled || openEnded} /></LabeledField>
          <label className="engineer-avail-check"><input type="checkbox" name="openEnded" value="1" checked={openEnded} onChange={event => setOpenEnded(event.target.checked)} />{ar ? "بدون تاريخ انتهاء" : "No end date"}</label>
          <SubmitButton variant="accent" className="engineer-avail-add"><PlusIcon size={18} />{ar ? "إضافة الفترة" : "Add period"}</SubmitButton>
        </form>
        {(!state.ok || failed) && <InlineError>{ar ? "تعذر حفظ التغيير. راجع التواريخ وحاول مجددًا." : "Could not save. Check the dates and try again."}</InlineError>}
        <Note>{ar ? "هذه الفترات لا تُخفي أي فرص حاليًا، ولا تغير حالة جاهزيتك الأساسية." : "These periods don't hide any opportunities yet, and don't change your overall availability."}</Note>
      </Panel>
    </fieldset>
  </div>;
}
