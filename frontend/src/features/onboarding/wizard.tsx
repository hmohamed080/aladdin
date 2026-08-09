"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Card } from "@/components/ui/primitives";
import { Button, Spinner } from "@/components/ui/controls";
import { cn } from "@/lib/ui/cn";

/**
 * Shared building blocks for the individual persona onboarding wizards (Sprint 7.4).
 * One system with the Sprint 7.1/7.3 cards: the same Card shell, a generic
 * N-step progress header, single-select choice cards, multi-select chips, and a
 * stable Back / Skip / Continue action row. All direction-neutral (logical
 * properties) so they mirror correctly in RTL without manual flipping.
 */

/** Generic "Step X of Y" header + segmented indicator for any step count. */
export function WizardProgress({ current, total, label }: { current: number; total: number; label: string }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-label font-medium text-fg-muted">
        {t("onboarding.stepLabel", { current: String(current + 1), total: String(total) })}
        <span className="mx-2 text-border-strong" aria-hidden="true">·</span>
        <span className="text-fg-secondary">{label}</span>
      </p>
      <ol
        className="flex items-center gap-2"
        aria-label={t("onboarding.stepLabel", { current: String(current + 1), total: String(total) })}
      >
        {Array.from({ length: total }).map((_, i) => (
          <li
            key={i}
            aria-current={i === current ? "step" : undefined}
            className={cn(
              "h-1.5 flex-1 rounded-pill transition-colors",
              i <= current ? "bg-accent-solid" : "bg-surface-2",
            )}
          />
        ))}
      </ol>
    </div>
  );
}

/** Card shell: progress + headline/subtitle + step body. */
export function WizardShell({
  progress,
  title,
  subtitle,
  children,
}: {
  progress: ReactNode;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-lg p-lg tablet:p-xl">
      {progress}
      <div className="flex flex-col gap-1">
        <h1 className="font-display-ar text-headline text-fg">{title}</h1>
        <p className="text-body-lg text-fg-secondary">{subtitle}</p>
      </div>
      {children}
    </Card>
  );
}

/** Single-select option card (intent, budget, availability, type, specialization). */
export function ChoiceCard({
  selected,
  title,
  description,
  onSelect,
}: {
  selected: boolean;
  title: string;
  description?: string;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex flex-col items-start gap-1 rounded-md border p-md text-start transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
        selected ? "border-accent bg-accent-solid/10" : "border-strong hover:bg-surface-2/60",
      )}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="font-medium text-fg">{title}</span>
        {selected ? <span className="shrink-0 text-label font-medium text-accent">{t("onboarding.accountType.selected")}</span> : null}
      </span>
      {description ? <span className="text-label text-fg-secondary">{description}</span> : null}
    </button>
  );
}

/** Multi-select toggle chip (interests, services, languages, service areas). */
export function ChoiceChip({ selected, label, onToggle }: { selected: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border px-3.5 py-2 text-label font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
        selected ? "border-accent bg-accent-solid/15 text-fg" : "border-strong text-fg-secondary hover:bg-surface-2/60",
      )}
    >
      {selected ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : null}
      {label}
    </button>
  );
}

/** Stable Back / Skip / Continue action row (never shifts between steps). */
export function FlowActions({
  onBack,
  onSkip,
  skipLabel,
  onPrimary,
  primaryLabel,
  primaryDisabled,
  pending,
}: {
  onBack?: () => void;
  onSkip?: () => void;
  skipLabel?: string;
  onPrimary: () => void;
  primaryLabel: string;
  primaryDisabled?: boolean;
  pending?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-sm">
      {onBack ? (
        <Button type="button" variant="ghost" onClick={onBack} disabled={pending}>
          {t("onboarding.back")}
        </Button>
      ) : null}
      {onSkip ? (
        <Button type="button" variant="ghost" onClick={onSkip} disabled={pending}>
          {skipLabel ?? t("onboarding.skip")}
        </Button>
      ) : null}
      <Button
        type="button"
        onClick={onPrimary}
        disabled={pending || primaryDisabled}
        aria-busy={pending}
        className="ms-auto flex-1 tablet:flex-none tablet:min-w-40"
      >
        {pending ? (
          <>
            <Spinner />
            {t("onboarding.saving")}
          </>
        ) : (
          primaryLabel
        )}
      </Button>
    </div>
  );
}

/** The calm "autosaved / your progress is saved" reassurance line. */
export function SavedHint() {
  const { t } = useI18n();
  return <p className="text-center text-label text-fg-muted">{t("onboarding.savedProgress")}</p>;
}
