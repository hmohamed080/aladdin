import type { Json } from "@/types/database.types";
import type {
  OrganizationActivityEvent,
  OrganizationActivityPage,
} from "@/server/queries/activity";
import type { ActivityFilters } from "@/lib/activity";
import { createTranslator, getMessages } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { formatDate, formatDateTime, formatMoney, formatRelativeTime } from "@/lib/ui/format";
import { ButtonLink } from "@/components/ui/controls";
import { Card, StatePanel } from "@/components/ui/primitives";
import { ActivityIcon } from "@/components/ui/icons";
import { ActivityFilterBar } from "./activity-filter-bar";
import { activityPageHref } from "./activity-filters";

function objectParams(value: Json): Record<string, Json | undefined> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function eventVariables(
  event: OrganizationActivityEvent,
  locale: Locale,
): Record<string, string | number> | undefined {
  const params = objectParams(event.params);
  switch (event.event_type) {
    case "rfq.submitted":
      return typeof params.item_count === "number" ? { item_count: params.item_count } : undefined;
    case "quotation.submitted":
    case "quotation.accepted":
    case "order.created":
      return typeof params.total === "number" ? { total: formatMoney(params.total, locale) } : undefined;
    case "followup.created":
      return typeof params.due_at === "string"
        ? { due_at: formatDateTime(params.due_at, locale) }
        : undefined;
    default:
      return undefined;
  }
}

function actorLabel(event: OrganizationActivityEvent, currentUserId: string | null, locale: Locale) {
  const messages = getMessages(locale).activity.actor;
  if (!event.actor_user_id) return messages.system;
  return event.actor_user_id === currentUserId ? messages.you : messages.other;
}

function groupedByDay(events: OrganizationActivityEvent[], locale: Locale) {
  const days = new Map<string, OrganizationActivityEvent[]>();
  for (const event of events) {
    const label = formatDate(event.created_at, locale);
    days.set(label, [...(days.get(label) ?? []), event]);
  }
  return days;
}

export function ActivityFeed({
  page,
  filters,
  before,
  currentUserId,
  locale,
}: {
  page: OrganizationActivityPage;
  filters: ActivityFilters;
  before?: string;
  currentUserId: string | null;
  locale: Locale;
}) {
  const m = getMessages(locale);
  const t = createTranslator(locale);
  const now = new Date();
  const isFiltered = Boolean(filters.family || filters.from || filters.to);
  const days = groupedByDay(page.events, locale);

  return (
    <>
      <ActivityFilterBar filters={filters} before={before} locale={locale} now={now} />

      {page.events.length === 0 ? (
        <StatePanel
          icon={<ActivityIcon size={22} />}
          title={isFiltered ? m.activity.filteredEmpty.title : m.activity.empty.title}
          body={isFiltered ? m.activity.filteredEmpty.body : m.activity.empty.body}
          action={
            isFiltered ? (
              <ButtonLink href="/b2b/activity" variant="outline">
                {m.activity.filters.clear}
              </ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <h2 className="text-title font-semibold text-fg">{m.activity.feedTitle}</h2>
          <div className="mt-md flex flex-col gap-lg">
            {[...days.entries()].map(([day, events]) => (
              <section key={day} aria-labelledby={`activity-day-${events[0]!.id}`}>
                <h3
                  id={`activity-day-${events[0]!.id}`}
                  className="text-label font-semibold text-fg-secondary"
                >
                  {day}
                </h3>
                <ol className="mt-xs flex flex-col divide-y">
                  {events.map((event) => {
                    const absoluteTime = formatDateTime(event.created_at, locale);
                    return (
                      <li
                        key={event.id}
                        className="flex items-start gap-sm py-sm first:pt-0 last:pb-0"
                      >
                        <span
                          aria-hidden="true"
                          className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-pill bg-accent-solid/10 text-accent"
                        >
                          <ActivityIcon size={16} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-body text-fg-secondary">
                            <span className="font-medium text-fg">
                              {actorLabel(event, currentUserId, locale)}
                            </span>{" "}
                            {t(
                              `activity.events.${event.event_type}`,
                              eventVariables(event, locale),
                            )}
                          </p>
                          <time
                            dateTime={event.created_at}
                            title={absoluteTime}
                            className="mt-1 flex flex-wrap items-center gap-xs text-caption text-fg-muted"
                          >
                            <span>{formatRelativeTime(event.created_at, locale, now)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{absoluteTime}</span>
                          </time>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        </Card>
      )}

      {page.nextBefore ? (
        <div className="flex justify-center">
          <ButtonLink
            href={activityPageHref(filters, page.nextBefore)}
            variant="outline"
          >
            {m.activity.older}
          </ButtonLink>
        </div>
      ) : null}
    </>
  );
}
