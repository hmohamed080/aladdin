import { formatDateTime } from "@/lib/ui/format";
import type { AdminVerificationEvent } from "@/features/admin-preview/directory-mappers";

export type VerificationHistoryLabels = {
  admin_initiated: string;
  review_started: string;
  changes_requested: string;
  approved: string;
  rejected: string;
  unknownAdmin: string;
  title: string;
};

/**
 * Decision history of ONE verification request for authorized Admins: each step of the workflow with the ACTING Admin's
 * name and the time, read from the immutable Audit Log (`admin_user_detail` / `admin_organization_detail`). Nothing is
 * stored twice and nothing here can change it.
 */
export function VerificationHistory({
  events,
  locale,
  labels,
}: {
  events: AdminVerificationEvent[];
  locale: Parameters<typeof formatDateTime>[1];
  labels: VerificationHistoryLabels;
}) {
  if (events.length === 0) return null;
  return (
    <ol aria-label={labels.title} className="mt-1 flex flex-col gap-0.5 text-label text-fg-muted" data-testid="verification-history">
      {events.map((e, i) => {
        const key = e.action.replace(/^verification\./, "") as keyof VerificationHistoryLabels;
        const label = key in labels ? labels[key] : e.action;
        return (
          <li key={`${e.action}-${e.at}-${i}`}>
            {label} <span className="font-medium text-fg-secondary">{e.actorName ?? labels.unknownAdmin}</span> · {formatDateTime(e.at, locale)}
          </li>
        );
      })}
    </ol>
  );
}
