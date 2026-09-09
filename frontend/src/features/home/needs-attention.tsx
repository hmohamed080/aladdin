import Link from "next/link";
import type { ComponentType } from "react";
import type { Locale } from "@/lib/i18n/locales";
import type { Messages } from "@/lib/i18n/messages/en";
import { formatPlural } from "@/lib/i18n/plural";
import { StatePanel } from "@/components/ui/primitives";
import { AlertIcon, InboxIcon, UsersIcon } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";

/**
 * "يحتاج تدخلك اليوم" — a compact, category-level SUMMARY, never a second
 * inbox of individual records. Three real, already-authorized counts
 * (overdue follow-ups, quotations awaiting this org's decision, pending
 * requests to join this org's team), each card deep-linking to the real
 * existing page/filter that can act on it. This component itself never
 * mutates anything — approving a join request or deciding a quotation both
 * stay on their own pages, exactly where the rest of the product already
 * does that work.
 *
 * Counts only, never titles or names: this component's props are plain
 * numbers, not record arrays — it is structurally incapable of leaking a
 * follow-up's title or a person's name, because it never receives one. The
 * caller (`showroom-dashboard.tsx`) uses count-only queries wherever one
 * exists (`countQuotations`) precisely so nothing more than a number ever
 * has to cross this boundary.
 *
 * VISIBILITY: `canSee*` is a genuine authorization gate, not a display
 * preference — a category the caller cannot see is never rendered, not even
 * as a silent "0" (a zero and "you're not authorized to know" must never
 * look the same). Among categories the caller CAN see, only the ones with a
 * real count > 0 render as cards; if none do, the section shows one shared
 * empty state rather than three empty cards.
 */
export type NeedsAttentionCard = {
  key: "overdue" | "quotations" | "joinRequests";
  count: number;
  canSee: boolean;
  Icon: ComponentType<{ size?: number }>;
  tone: "danger" | "warning" | "info";
  titleKey: "overdueFollowUpsTitle" | "quotationsTitle" | "joinRequestsTitle";
  bodyKey: "overdueFollowUpsBody" | "quotationsBody" | "joinRequestsBody";
  href: string;
};

/**
 * Semantic color lives ONLY in the icon chip — the same "one contrasting
 * chip inside an otherwise neutral surface" grammar `stat-tiles.tsx` uses for
 * the KPI row above this section. Tinting the whole card red/amber/blue read
 * as a different design system from those KPI cards; a neutral `bg-surface`
 * card (picking up the shell's own light/dark elevation via
 * `.workspace-body .bg-surface` in globals.css) makes this section read as
 * part of the same dashboard.
 */
const TONE_CHIP: Record<NeedsAttentionCard["tone"], string> = {
  danger: "bg-danger/15 text-danger",
  warning: "bg-warning/15 text-warning",
  info: "bg-info/15 text-info",
};

export function NeedsAttentionSection({
  overdueFollowUpsCount,
  quotationsAwaitingDecisionCount,
  pendingJoinRequestsCount,
  canSeeOverdueFollowUps,
  canSeeQuotations,
  canSeeJoinRequests,
  locale,
  m,
}: {
  overdueFollowUpsCount: number;
  quotationsAwaitingDecisionCount: number;
  pendingJoinRequestsCount: number;
  canSeeOverdueFollowUps: boolean;
  canSeeQuotations: boolean;
  canSeeJoinRequests: boolean;
  locale: Locale;
  m: Messages;
}) {
  const t = m.home.needsAttention;

  // Card order is fixed in the JSX below and DOES NOT special-case locale —
  // the ambient `dir` (set once, on the whole document, by I18nProvider)
  // already places DOM-first at the visual "logical start", which is the
  // right edge in Arabic and the left edge in English. Reordering here would
  // fight that rather than use it.
  const allCards: NeedsAttentionCard[] = [
    {
      key: "overdue",
      count: overdueFollowUpsCount,
      canSee: canSeeOverdueFollowUps,
      Icon: AlertIcon,
      tone: "danger",
      titleKey: "overdueFollowUpsTitle",
      bodyKey: "overdueFollowUpsBody",
      href: "/b2b/follow-ups",
    },
    {
      key: "quotations",
      count: quotationsAwaitingDecisionCount,
      canSee: canSeeQuotations,
      Icon: InboxIcon,
      tone: "warning",
      titleKey: "quotationsTitle",
      bodyKey: "quotationsBody",
      // `view=received` is a real, supported param on /b2b/quotations (not
      // invented): it is the requester-side inbox, which is exactly
      // "quotations awaiting THIS org's decision" — there is no separate
      // status query param on that page, so this is the closest real filter.
      href: "/b2b/quotations?view=received",
    },
    {
      key: "joinRequests",
      count: pendingJoinRequestsCount,
      canSee: canSeeJoinRequests,
      Icon: UsersIcon,
      tone: "info",
      titleKey: "joinRequestsTitle",
      bodyKey: "joinRequestsBody",
      href: "/b2b/organization",
    },
  ];

  // Authorized AND actionable — an authorized-but-empty category is simply
  // omitted, never shown as a hollow "0" card (see the module doc comment).
  const cards = allCards.filter((c) => c.canSee && c.count > 0);

  return (
    <section className="flex flex-col gap-md" aria-labelledby="needs-attention-heading">
      {/* `gap-sm` (8px): the earlier `gap-xs` (4px) closed most of the gap
          but visual review still read the heading and description as
          crowded. `leading-normal` on the description (`text-label`'s own
          baked-in line-height is a tight 1.2) is the other half of that —
          a merged-looking pair is as often a too-tight LINE-HEIGHT on the
          second line as it is too little space between the two. */}
      <div className="flex flex-col gap-sm">
        <h2 id="needs-attention-heading" className="text-title text-fg">
          {t.title}
        </h2>
        <p className="text-label leading-normal text-fg-muted">{t.subtitle}</p>
      </div>

      {cards.length === 0 ? (
        <StatePanel title={t.emptyTitle} body={t.emptyBody} tone="neutral" />
      ) : (
        // Fixed-width tracks, not `auto-fit`/`auto-fill`: with 1 or 2 cards,
        // the remaining column(s) stay genuinely empty rather than stretching
        // the card(s) into a full-width banner — "keep them as compact equal
        // cards" from a plain `repeat(3, 1fr)`-shaped grid, for free.
        <ul className="grid grid-cols-1 gap-md tablet:grid-cols-2 desktop:grid-cols-3">
          {cards.map((card) => {
            const chip = TONE_CHIP[card.tone];
            const title = formatPlural(card.count, locale, t[card.titleKey]);
            const body = t[card.bodyKey];
            return (
              <li key={card.key}>
                <Link
                  href={card.href}
                  className={cn(
                    // Same neutral surface as the KPI tiles above this
                    // section (`stat-tiles.tsx`'s `tileSurfaceClass`) — one
                    // clean `bg-surface`, not a colored outer shell. The
                    // shell's global elevation rule
                    // (`.workspace-body .bg-surface` in globals.css) supplies
                    // the border/shadow for both themes; adding Tailwind's
                    // own `border`/`shadow-card` on top would double it (the
                    // "card inside a card" defect `stat-tiles.tsx` documents).
                    "flex h-full items-start gap-3 rounded-md bg-surface p-md transition-colors hover:bg-surface-2/50",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                  )}
                >
                  <span
                    className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-sm", chip)}
                    aria-hidden="true"
                  >
                    <card.Icon size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body-lg font-semibold leading-snug text-fg">{title}</span>
                    {/* `mt-sm` (8px), not the earlier `mt-xs` (4px) — a real
                        stack gap, not a margin doing the work line-height
                        should. `leading-normal` on the subtitle (`text-label`
                        bakes in a tight 1.2) is the other half: at 1.2 the
                        subtitle read cramped even with the wider gap above
                        it, and a wrapping title's own `leading-snug` (1.375)
                        keeps ITS two lines from colliding without pushing
                        the card taller than it needs to be. */}
                    <span className="mt-sm block text-label leading-normal text-fg-secondary">{body}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
