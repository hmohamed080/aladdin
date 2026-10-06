import { BriefcaseIcon, ClipboardIcon } from "@/components/ui/icons";
import type { Locale } from "@/lib/i18n/locales";
import type { TranslateFn } from "@/lib/i18n/translate";
import { formatCount } from "@/lib/ui/format";
import type { JobAssignmentStatus } from "@/lib/work/assignment-state";
import { RailAside, RailCard, RailLink, RailRow } from "@/features/installer-my-work-preview/installer-my-work-view";

/**
 * The right-hand rail of the real My Work page, in the approved rail's visual
 * language but carrying only what exists:
 *   - the REAL status summary: the same counts the tabs carry, each row linking to
 *     its own tab, derived from the same rows as the list beside it;
 *   - navigation to the surfaces either side of this one.
 *
 * There is no documents panel, no quick-tools list and no "completed this month":
 * the file storage and the four tools have no backend, and that metric has no
 * definition. Absent, not faked.
 */
export function InstallerWorkRail({
  counts,
  locale,
  t,
}: {
  counts: Record<JobAssignmentStatus, number>;
  locale: Locale;
  t: TranslateFn;
}) {
  const rows: { key: string; label: string; value: number; href: string }[] = [
    { key: "current", label: t("work.summary.current"), value: counts.scheduled + counts.in_progress, href: "/home/work?state=current" },
    { key: "scheduled", label: t("work.summary.scheduled"), value: counts.scheduled, href: "/home/work?state=scheduled" },
    { key: "in_progress", label: t("work.summary.in_progress"), value: counts.in_progress, href: "/home/work?state=in_progress" },
    { key: "completed", label: t("work.summary.completed"), value: counts.completed, href: "/home/work?state=completed" },
    { key: "cancelled", label: t("work.summary.cancelled"), value: counts.cancelled, href: "/home/work?state=cancelled" },
  ];
  const links = [
    { href: "/home/jobs", label: t("work.quick.browse") },
    { href: "/home/jobs/applications", label: t("work.quick.applications") },
    { href: "/home/profile", label: t("work.quick.profile") },
  ];

  return (
    <RailAside label={t("work.summary.title")} compact>
      <RailCard title={t("work.summary.title")} icon={<ClipboardIcon size={19} />}>
        {rows.map((row) => (
          <RailRow key={row.key} label={row.label} value={formatCount(row.value, locale)} href={row.href} />
        ))}
      </RailCard>
      <RailCard title={t("work.quick.title")} icon={<BriefcaseIcon size={19} />}>
        {links.map((link) => (
          <RailLink key={link.href} href={link.href}>{link.label}</RailLink>
        ))}
      </RailCard>
    </RailAside>
  );
}
