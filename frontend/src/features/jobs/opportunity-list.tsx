"use client";

import { useI18n } from "@/lib/i18n/context";
import { Card, Badge, StatePanel } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/controls";
import { MapPinIcon, CalendarIcon, BriefcaseIcon } from "@/components/ui/icons";
import { tradeLabel } from "@/lib/i18n/trade-label";
import { formatMoney, formatDate, formatRelativeTime } from "@/lib/ui/format";
import type { Locale } from "@/lib/i18n/locales";
import type { OpportunityRow } from "@/server/queries/job-opportunities";

/**
 * The professional's discovery surface.
 *
 * The reference board (`02-job-opportunities.jpg`) is the composition this
 * follows: a card per opening, identity and organization leading, the practical
 * facts as a chip row, compensation given real weight, and one action. What it
 * deliberately does NOT follow is everything on that board with no authority
 * behind it — the match percentages, the distances in kilometres, the bookmark
 * hearts, the "most requested" sort and the photographs. Each of those would be
 * a number or an affordance this product cannot honour, and a professional
 * choosing work would reasonably believe every one of them.
 *
 * SO THE CARD SHOWS EXACTLY WHAT THE READ SEAM HOLDS. Title, poster, trade,
 * place, compensation, duration, start, when it was posted, and whether this
 * caller has already applied. Nothing derived, nothing scored, nothing ranked.
 *
 * ONE PRIMARY ACTION. "View details" and not "Apply now": applying is a
 * deliberate act against a stated amount, and the place to take it is the page
 * that states the amount in full — not a card in a grid.
 *
 * DENSITY CORRECTION (Increment 14): the reference packs three of these per
 * row with far less air around each fact than the original pass gave it, even
 * with no photograph to fill. `pad="sm"` and `gap-sm` throughout, and the grid
 * itself opens to three columns once the filter rail's own width is out of the
 * way (from `wide`, 1440px and up) — narrower than that, two stays the honest
 * answer rather than forcing a third column an Arabic label would wrap badly
 * inside.
 */

export function OpportunityList({
  opportunities,
  locale,
  filtered,
}: {
  opportunities: readonly OpportunityRow[];
  locale: Locale;
  /** Whether any filter is active — it changes what "empty" MEANS. */
  filtered: boolean;
}) {
  const { t } = useI18n();

  if (opportunities.length === 0) {
    return (
      <StatePanel
        icon={<BriefcaseIcon size={20} />}
        title={t(filtered ? "jobs.opportunities.noResultsTitle" : "jobs.opportunities.emptyTitle")}
        body={t(filtered ? "jobs.opportunities.noResultsBody" : "jobs.opportunities.emptyBody")}
      />
    );
  }

  return (
    <ul className="grid gap-sm tablet:grid-cols-2 wide:grid-cols-3">
      {opportunities.map((o) => (
        <li key={o.id} className="min-w-0">
          <OpportunityCard opportunity={o} locale={locale} />
        </li>
      ))}
    </ul>
  );
}

export function OpportunityCard({
  opportunity: o,
  locale,
}: {
  opportunity: OpportunityRow;
  locale: Locale;
}) {
  const { t } = useI18n();
  const place = [o.city, o.governorate].filter(Boolean).join(", ");

  return (
    <Card pad="sm" className="flex h-full flex-col gap-sm">
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div className="min-w-0">
          <h3 className="text-title text-fg">{o.title}</h3>
          {o.poster_org_name ? (
            // NOT `truncate`: this line mixes the (Arabic) "posted by" prefix with
            // the organization's own name, and clipping a single-direction ellipsis
            // across a bidi boundary cuts into the WRONG end of an LTR name inside
            // an RTL line (verified against the 1440px capture — "Delta Wholesale
            // Supply" clipped to "elta Wholesale Supply"). `<bdi dir="auto">` still
            // isolates the name's own shaping; wrapping onto a second line, not
            // truncation, is what keeps it legible.
            <p className="mt-0.5 text-caption text-fg-secondary">
              {t("jobs.opportunities.postedBy")} <bdi dir="auto">{o.poster_org_name}</bdi>
            </p>
          ) : null}
        </div>
        {/* Not a decoration: it is the difference between an opening the reader
            has considered and one they have not. */}
        {o.has_applied ? (
          <Badge tone="info">{t("jobs.opportunities.appliedBadge")}</Badge>
        ) : null}
      </div>

      {/* The facts, as chips, so they wrap rather than collide at 390px. */}
      <ul className="flex flex-wrap gap-x-sm gap-y-1 text-caption text-fg-secondary">
        {o.trade_key ? (
          <Chip icon={<BriefcaseIcon size={13} />}>{tradeLabel(t, o.trade_key)}</Chip>
        ) : null}
        {place ? <Chip icon={<MapPinIcon size={13} />}>{place}</Chip> : null}
        {o.expected_duration_days ? (
          <Chip icon={<CalendarIcon size={13} />}>
            {t("jobs.opportunities.duration", { n: o.expected_duration_days })}
          </Chip>
        ) : null}
        {o.starts_on ? (
          <Chip icon={<CalendarIcon size={13} />}>
            {t("jobs.opportunities.startsOn", { date: formatDate(o.starts_on, locale) })}
          </Chip>
        ) : null}
      </ul>

      <div className="mt-auto flex flex-wrap items-end justify-between gap-sm border-t pt-sm">
        <div className="min-w-0">
          {/* `formatMoney` already emits the currency — appending "EGP" here is
              exactly the bug Increment 7's browser pass found on the poster side. */}
          <p className="text-body-lg font-semibold text-fg">
            {formatMoney(o.offered_amount, locale)}
          </p>
          {o.published_at ? (
            <p className="text-caption text-fg-muted">
              {t("jobs.opportunities.published", {
                when: formatRelativeTime(o.published_at, locale),
              })}
            </p>
          ) : null}
        </div>
        <ButtonLink href={`/home/jobs/${o.id}`} variant="primary" size="sm">
          {t("jobs.opportunities.view")}
        </ButtonLink>
      </div>
    </Card>
  );
}

function Chip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex min-w-0 items-center gap-1">
      <span aria-hidden="true" className="shrink-0 text-fg-muted">
        {icon}
      </span>
      <span className="truncate">{children}</span>
    </li>
  );
}
