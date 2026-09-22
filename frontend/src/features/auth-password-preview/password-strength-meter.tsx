"use client";

import { useI18n } from "@/lib/i18n/context";
import { strengthOf, PASSWORD_MIN_LENGTH } from "./password-policy";
import type { PasswordStrengthLevel } from "./password-strength";
import { cn } from "@/lib/ui/cn";

const LEVEL_COLOR: Record<PasswordStrengthLevel, string> = {
  weak: "bg-danger",
  acceptable: "bg-warning",
  strong: "bg-success",
};

/**
 * Modern, NIST-SP-800-63B-style guidance: a strength METER (informational,
 * never itself the pass/fail gate) plus three live requirement rows that ARE
 * the actual gate (mirrored server-side by `password-policy.ts`'s
 * `superRefine`) and one purely informational "longer is stronger" tip.
 * Composition variety (upper/lower/digit/symbol) is never a listed
 * requirement — it only nudges the meter fill, per the product decision to
 * reject mandatory composition rules as the security mechanism.
 */
export function PasswordStrengthMeter({ value, context = [] }: { value: string; context?: string[] }) {
  const { t } = useI18n();
  const s = strengthOf(value, context);
  const empty = value.length === 0;

  const rows: Array<{ key: string; met: boolean; label: string }> = [
    { key: "minLength", met: value.length >= PASSWORD_MIN_LENGTH, label: t("authPasswordPreview.guidance.minLength", { min: PASSWORD_MIN_LENGTH }) },
    { key: "notCommon", met: !empty && !s.common && !s.sequential, label: t("authPasswordPreview.guidance.notCommon") },
    { key: "notAccountRelated", met: !empty && !s.accountRelated, label: t("authPasswordPreview.guidance.notAccountRelated") },
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2" aria-hidden="true">
        {[0, 1, 2, 3].map((segment) => (
          <span
            key={segment}
            className={cn(
              "h-1.5 flex-1 rounded-pill transition-colors duration-fast",
              !empty && segment < s.score ? LEVEL_COLOR[s.level] : "bg-surface-2",
            )}
          />
        ))}
      </div>
      <p role="status" aria-live="polite" className={cn("text-label font-medium", empty ? "text-fg-muted" : LEVEL_COLOR[s.level].replace("bg-", "text-"))}>
        {empty ? t("authPasswordPreview.guidance.minLength", { min: PASSWORD_MIN_LENGTH }) : t("authPasswordPreview.strength.meterLabel", { level: t(`authPasswordPreview.strength.${s.level}`) })}
      </p>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.key} className={cn("flex items-center gap-1.5 text-label", row.met ? "text-success" : "text-fg-muted")}>
            <CheckOrDot met={row.met} />
            {row.label}
          </li>
        ))}
        <li className="flex items-center gap-1.5 text-label text-fg-muted">
          <CheckOrDot met={false} tip />
          {t("authPasswordPreview.guidance.longer")}
        </li>
      </ul>
    </div>
  );
}

function CheckOrDot({ met, tip = false }: { met: boolean; tip?: boolean }) {
  if (tip) {
    return <span aria-hidden="true" className="inline-block h-1 w-1 shrink-0 rounded-pill bg-fg-muted" />;
  }
  return met ? (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ) : (
    <span aria-hidden="true" className="inline-block h-1 w-1 shrink-0 rounded-pill bg-fg-muted" />
  );
}
