import Link from "next/link";
import type { ReactNode } from "react";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import type { Locale } from "@/lib/i18n/locales";
import { cn } from "@/lib/ui/cn";

/** One numbered section of the approved "Complete your profile" page, around a REAL editor. */
export function ProfileSection({ id, step, title, description, children }: { id: string; step: number; title: string; description: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 rounded-md border border-strong bg-surface p-md shadow-card tablet:p-lg">
      <div className="mb-md flex items-start gap-sm border-b pb-md">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-pill bg-primary text-label font-semibold text-primary-foreground">{step}</span>
        <div>
          <h2 id={`${id}-title`} className="text-title text-fg">{title}</h2>
          <p className="mt-1 text-label text-fg-secondary">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export type ProfileStep = { id: string; label: string; done: boolean };

/**
 * The approved progress rail: the database's own completion percentage (`my_profile_completion`) and the four sections,
 * each marked done from real data. Each step links to its section.
 */
export function ProfileProgressRail({ locale, percent, steps, tips }: { locale: Locale; percent: number; steps: readonly ProfileStep[]; tips: readonly string[] }) {
  const ar = locale === "ar";
  const Chevron = ar ? ChevronLeftIcon : ChevronRightIcon;
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <aside className="order-1 flex min-w-0 flex-col gap-md desktop:order-2" data-testid="profile-progress">
      <section className="rounded-md border border-strong bg-surface p-md shadow-card">
        <div className="flex items-center gap-sm">
          <span className="relative grid h-16 w-16 shrink-0 place-items-center">
            <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
              <circle cx="20" cy="20" r="17" fill="none" className="stroke-accent-solid/20" strokeWidth="3" />
              <circle cx="20" cy="20" r="17" fill="none" className="stroke-accent-solid" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(clamped / 100) * 107} 107`} />
            </svg>
            <strong className="relative text-label font-bold tabular-nums text-fg">{clamped}%</strong>
          </span>
          <h2 className="text-body font-semibold text-fg">{ar ? "مستوى إكمال الملف" : "Profile completion"}</h2>
        </div>
        <ol className="mt-md flex flex-col gap-1">
          {steps.map((step, index) => (
            <li key={step.id}>
              <Link href={`#${step.id}`} className="flex min-h-10 items-center gap-sm rounded-sm px-sm text-label text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-pill text-caption font-semibold", step.done ? "bg-success text-on-accent" : "bg-primary text-primary-foreground")}>
                  {step.done ? <CheckIcon size={13} /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">{step.label}</span>
                <Chevron size={14} className="shrink-0 text-fg-muted" />
              </Link>
            </li>
          ))}
        </ol>
      </section>
      {tips.length ? (
        <section className="rounded-md border border-strong bg-surface p-md shadow-card">
          <h2 className="text-body font-semibold text-fg">{ar ? "نصائح سريعة" : "Quick tips"}</h2>
          <ul className="mt-sm flex flex-col gap-sm">
            {tips.map((tip) => <li key={tip} className="flex items-start gap-sm text-label text-fg-secondary"><CheckIcon size={14} className="mt-0.5 shrink-0 text-accent-solid" />{tip}</li>)}
          </ul>
        </section>
      ) : null}
    </aside>
  );
}
