"use client";

import { useI18n } from "@/lib/i18n/context";
import { formatDateTime } from "@/lib/ui/format";
import type { ActivityRow } from "@/server/queries/sales";

/** A vertical, RTL-safe timeline of sales activities. */
export function ActivityTimeline({ activities }: { activities: ActivityRow[] }) {
  const { t, locale } = useI18n();
  return (
    <ol className="flex flex-col gap-md">
      {activities.map((a) => (
        <li key={a.id} className="flex gap-md border-s-2 border-border ps-md">
          <div className="flex-1">
            <div className="flex items-center justify-between gap-md">
              <span className="text-label text-accent">{t(`activities.${a.activity_type}`)}</span>
              <span className="text-label text-fg-muted">{formatDateTime(a.occurred_at, locale)}</span>
            </div>
            <p className="mt-0.5 text-body text-fg">{a.summary}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
