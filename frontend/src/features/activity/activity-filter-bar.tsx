import { ButtonLink } from "@/components/ui/controls";
import { Card } from "@/components/ui/primitives";
import { ACTIVITY_EVENT_FAMILIES, type ActivityFilters } from "@/lib/activity";
import { getMessages } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { activityFilterHref } from "./activity-filters";

function dateDaysAgo(today: string, days: number): string {
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function ActivityFilterBar({
  filters,
  before,
  locale,
  now,
}: {
  filters: ActivityFilters;
  before?: string;
  locale: Locale;
  now: Date;
}) {
  const m = getMessages(locale).activity.filters;
  const current = { ...filters, before };
  const today = now.toISOString().slice(0, 10);
  const ranges = [
    { label: m.last7, from: dateDaysAgo(today, 6), to: today },
    { label: m.last30, from: dateDaysAgo(today, 29), to: today },
    { label: m.last90, from: dateDaysAgo(today, 89), to: today },
  ];

  return (
    <Card pad="sm" className="flex flex-col gap-md">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <h2 className="text-title font-semibold text-fg">{m.title}</h2>
        {filters.family || filters.from || filters.to ? (
          <ButtonLink href="/b2b/activity" variant="ghost" size="sm">
            {m.clear}
          </ButtonLink>
        ) : null}
      </div>

      <div className="flex flex-col gap-xs">
        <p className="text-label font-medium text-fg-secondary">{m.family}</p>
        <div className="flex flex-wrap gap-xs">
          <ButtonLink
            href={activityFilterHref(current, { family: undefined })}
            variant={!filters.family ? "accent" : "outline"}
            size="sm"
          >
            {m.allFamilies}
          </ButtonLink>
          {ACTIVITY_EVENT_FAMILIES.map((family) => (
            <ButtonLink
              key={family}
              href={activityFilterHref(current, { family })}
              variant={filters.family === family ? "accent" : "outline"}
              size="sm"
            >
              {m.families[family]}
            </ButtonLink>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-xs">
        <p className="text-label font-medium text-fg-secondary">{m.dateRange}</p>
        <div className="flex flex-wrap gap-xs">
          <ButtonLink
            href={activityFilterHref(current, { from: undefined, to: undefined })}
            variant={!filters.from && !filters.to ? "accent" : "outline"}
            size="sm"
          >
            {m.allDates}
          </ButtonLink>
          {ranges.map((range) => (
            <ButtonLink
              key={range.from}
              href={activityFilterHref(current, { from: range.from, to: range.to })}
              variant={
                filters.from === range.from && filters.to === range.to ? "accent" : "outline"
              }
              size="sm"
            >
              {range.label}
            </ButtonLink>
          ))}
        </div>
      </div>
    </Card>
  );
}
