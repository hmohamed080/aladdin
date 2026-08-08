import type { ReactNode } from "react";
import { Card } from "@/components/ui/primitives";
import { ProgressHeader, type OnboardingStep } from "@/features/onboarding/progress-header";

/**
 * Shared shell for the three collected onboarding steps: progress header + a
 * headline/subtitle + the step body. Keeps every step visually identical to the
 * Sprint 7.1 auth cards (one system), Arabic-first and RTL-correct.
 */
export function StepCard({
  step,
  title,
  subtitle,
  children,
}: {
  step: OnboardingStep;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-lg p-lg tablet:p-xl">
      <ProgressHeader current={step} />
      <div className="flex flex-col gap-1">
        <h1 className="font-display-ar text-headline text-fg">{title}</h1>
        <p className="text-body-lg text-fg-secondary">{subtitle}</p>
      </div>
      {children}
    </Card>
  );
}
