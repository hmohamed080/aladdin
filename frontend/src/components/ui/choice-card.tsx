"use client";

import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";

/**
 * Single-select option card (onboarding intent/budget/availability/type/
 * specialization/account-type, and the public Landing Page's audience tiles).
 * The one canonical choice-card implementation — every selection grid in the
 * product renders through this, never a local re-implementation.
 *
 * `disabled` + `badge` support a visible-but-not-yet-selectable option (e.g. a
 * "Coming soon" account type): still shown, still readable, but truly
 * non-interactive — a native `disabled` button, not just a dimmed click
 * target, so it can't be activated by mouse, touch, or keyboard.
 */
export function ChoiceCard({
  selected,
  title,
  description,
  onSelect,
  disabled = false,
  badge,
}: {
  selected: boolean;
  title: string;
  description?: string;
  onSelect: () => void;
  disabled?: boolean;
  badge?: string;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={disabled ? undefined : selected}
      className={cn(
        "flex flex-col items-start gap-1 rounded-md border p-md text-start transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
        "disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-transparent",
        selected ? "border-accent bg-accent-solid/10" : "border-strong hover:bg-surface-2/60",
      )}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className={cn("font-medium", disabled ? "text-fg-muted" : "text-fg")}>{title}</span>
        {badge ? (
          <span className="shrink-0 rounded-pill bg-surface-2 px-2 py-0.5 text-label font-medium text-fg-muted">{badge}</span>
        ) : selected ? (
          // Reused as-is: a tile outside the onboarding wizard (e.g. the
          // Landing Page's navigational audience tiles) never sets `selected`,
          // so this branch never renders there.
          <span className="shrink-0 text-label font-medium text-accent">{t("onboarding.accountType.selected")}</span>
        ) : null}
      </span>
      {description ? <span className="text-label text-fg-secondary">{description}</span> : null}
    </button>
  );
}
