"use client";

import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";

/** The three collected steps of the shared onboarding engine (handoff excluded). */
export const ONBOARDING_STEPS = ["profile", "contact", "account_type"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

const STEP_LABEL_KEY: Record<OnboardingStep, string> = {
  profile: "onboarding.stepProfile",
  contact: "onboarding.stepContact",
  account_type: "onboarding.stepAccountType",
};

/**
 * Progress header for the shared onboarding steps. Shows "Step X of Y" plus a
 * segmented indicator with the completed/current/upcoming state. Direction-neutral:
 * it uses logical flex order and the segments read start→end, so it mirrors
 * correctly in RTL without any manual flipping.
 */
export function ProgressHeader({ current }: { current: OnboardingStep }) {
  const { t } = useI18n();
  const total = ONBOARDING_STEPS.length;
  const index = ONBOARDING_STEPS.indexOf(current);

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-label font-medium text-fg-muted">
        {t("onboarding.stepLabel", { current: String(index + 1), total: String(total) })}
        <span className="mx-2 text-border-strong" aria-hidden="true">·</span>
        <span className="text-fg-secondary">{t(STEP_LABEL_KEY[current])}</span>
      </p>
      <ol className="flex items-center gap-2" aria-label={t("onboarding.stepLabel", { current: String(index + 1), total: String(total) })}>
        {ONBOARDING_STEPS.map((step, i) => {
          const done = i < index;
          const active = i === index;
          return (
            <li
              key={step}
              aria-current={active ? "step" : undefined}
              className={cn(
                "h-1.5 flex-1 rounded-pill transition-colors",
                done || active ? "bg-accent-solid" : "bg-surface-2",
              )}
            />
          );
        })}
      </ol>
    </div>
  );
}
