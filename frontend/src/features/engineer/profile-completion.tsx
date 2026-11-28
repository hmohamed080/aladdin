"use client";

import Image from "next/image";
import { useState, useEffect, type ReactNode } from "react";

import { Button, ButtonLink } from "@/components/ui/controls";
import { ProgressMeter } from "@/components/ui/primitives";
import { CheckIcon, UserIcon, BriefcaseIcon, CalendarIcon, LayersIcon, ArrowUpRightIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import type { ProfileCompletion } from "@/server/queries/profile-identity";
import "./profile-completion.css";

const steps = [
  { ar: "المعلومات الأساسية", en: "Basic information", Icon: UserIcon, hintAr: "أضف صورتك واسمك وبيانات التواصل.", hintEn: "Add your photo, name and contact details." },
  { ar: "الخبرات ونطاق العمل", en: "Expertise & work areas", Icon: BriefcaseIcon, hintAr: "عرّف العملاء بخبراتك وخدماتك والمناطق التي تعمل بها.", hintEn: "Describe your experience, services and the areas you cover." },
  { ar: "إتاحة العمل", en: "Work availability", Icon: CalendarIcon, hintAr: "حدد حالتك الحالية وموعد جاهزيتك لاستقبال المشاريع الجديدة.", hintEn: "Set your current status and when you can start new projects." },
  { ar: "سابقة الأعمال", en: "Work history", Icon: LayersIcon, hintAr: "أضف أعمالك الحقيقية واختر ما تريد نشره في ملفك العام.", hintEn: "Add your own work and choose what to publish on your public profile." },
] as const;

export function EngineerProfileCompletion({ name, avatar, completion, panels, initialStep = 0 }: {
  name: string; avatar: string | null; completion: ProfileCompletion | null; panels: ReactNode[]; initialStep?: number;
}) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const [active, setActive] = useState(initialStep);
  useEffect(() => {
    const restore = () => {
      const step = Number(new URLSearchParams(window.location.search).get("step"));
      setActive(Number.isInteger(step) && step >= 0 && step < steps.length ? step : 0);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const select = (index: number) => {
    setActive(index);
    const url = new URL(window.location.href);
    url.searchParams.set("step", String(index));
    window.history.replaceState(null, "", url);
  };
  return (
    <div className="engineer-completion-workspace flex min-w-0 flex-col gap-lg">
      <header className="engineer-edit-hero relative isolate overflow-hidden rounded-lg bg-shell text-shell-fg">
        <Image src="/assets/engineer/hero-living-room.webp" alt="" fill sizes="(min-width: 1024px) 75vw, 100vw" className="object-cover opacity-30" />
        <div className="relative flex flex-col items-start gap-md p-lg tablet:flex-row tablet:flex-wrap tablet:items-center tablet:gap-lg tablet:p-xl">
          <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-pill border-2 border-surface bg-surface text-fg">
            {avatar ? <Image src={avatar} alt="" width={80} height={80} className="size-full object-cover" unoptimized /> : <UserIcon size={32} />}
          </div>
          <div className="w-full min-w-0 tablet:w-auto tablet:flex-1">
            <h1 className="text-headline font-semibold text-shell-fg">{ar ? "تعديل الملف الشخصي" : "Edit your profile"}</h1>
            <p className="mt-2 text-label text-shell-fg">{name}</p>
            <p className="mt-1 max-w-prose text-label">{ar ? "خبراتك وأعمالك تساعد العملاء في اختيارك لمشروعهم القادم." : "Your experience and work help clients choose you for their next project."}</p>
          </div>
          <ButtonLink href="/home/profile" variant="accent">{ar ? "عرض ملفي" : "View my profile"}<ArrowUpRightIcon size={16} /></ButtonLink>
        </div>
      </header>
      <div className="grid min-w-0 items-start gap-lg desktop:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-md desktop:sticky desktop:top-24">
          <div className="rounded-md border bg-surface p-lg">
            <h2 className="text-title font-semibold">{ar ? "ملفك المهني" : "Your professional profile"}</h2>
            {completion ? <div className="mt-md">
              <div className="mb-2 flex justify-between text-label"><span>{ar ? "اكتمال البيانات المحفوظة" : "Saved profile completion"}</span><b dir="ltr">{completion.percent}%</b></div>
              <ProgressMeter value={completion.percent} tone="accent" size="sm" label={ar ? "اكتمال الملف" : "Profile completion"} />
            </div> : <p className="mt-2 text-label text-fg-secondary">{ar ? "تعذّر تحميل نسبة الاكتمال. يمكنك متابعة التعديل." : "Completion is unavailable. You can still edit your profile."}</p>}
            <nav aria-label={ar ? "خطوات استكمال الملف" : "Profile completion steps"} className="mt-lg grid grid-cols-2 gap-2 desktop:grid-cols-1">
              {steps.map((step, index) => <button key={step.en} type="button" aria-current={index === active ? "step" : undefined} onClick={() => select(index)} className={`flex min-h-12 items-center gap-sm rounded-sm px-3 py-2 text-left rtl:text-right text-label transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring focus-visible:ring-offset-2 ${index === active ? "bg-primary text-primary-foreground" : "text-fg-secondary hover:bg-surface-2"}`}>
                <span className="grid size-7 shrink-0 place-items-center rounded-pill border border-strong" aria-label={completion?.sections?.[index] ? (ar ? "مكتمل" : "Complete") : undefined}>{completion?.sections?.[index] ? <CheckIcon size={17} /> : index + 1}</span><span>{ar ? step.ar : step.en}</span>
              </button>)}
            </nav>
          </div>
          <p className="px-1 text-label leading-relaxed text-fg-secondary">{ar ? "احفظ التغييرات داخل كل قسم. يمكنك التنقل بين الخطوات والعودة لإكمال ملفك في أي وقت. اكتمال الملف لا يعني توثيق الحساب." : "Save changes within each section. Move between steps and return whenever you like. Profile completion does not verify your account."}</p>
        </aside>
        <div className="engineer-edit-content min-w-0">
          {steps.map((step, index) => <section className="engineer-edit-section" data-step={index} key={step.en} hidden={active !== index} aria-labelledby={`completion-step-${index}`}>
            <div className="engineer-edit-section-heading mb-lg flex items-start gap-sm border-b pb-md">
              <span className="grid size-8 shrink-0 place-items-center rounded-pill bg-primary text-label font-semibold text-primary-foreground">{index + 1}</span>
              <div><h2 id={`completion-step-${index}`} className="text-title font-semibold">{ar ? step.ar : step.en}</h2><p className="mt-1 text-label text-fg-secondary">{ar ? step.hintAr : step.hintEn}</p></div>
            </div>
            {panels[index]}
            {index === 0 && <div id="engineer-location-slot" />}
          </section>)}
          <div className="engineer-edit-footer mt-lg flex flex-wrap items-center justify-between gap-sm border-t pt-md">
            <Button variant="outline" disabled={active === 0} onClick={() => select(active - 1)}>{ar ? "السابق" : "Previous"}</Button>
            {active < steps.length - 1 ? <Button onClick={() => select(active + 1)}>{ar ? "التالي" : "Next"}</Button> : <ButtonLink href="/home/profile">{ar ? "العودة إلى ملفي" : "Back to my profile"}</ButtonLink>}
          </div>
        </div>
      </div>
      <div id="engineer-save-slot" />
    </div>
  );
}





