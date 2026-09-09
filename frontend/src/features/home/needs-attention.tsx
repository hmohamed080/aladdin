import Link from "next/link";
import type { ComponentType } from "react";
import type { Locale } from "@/lib/i18n/locales";
import type { Messages } from "@/lib/i18n/messages/en";
import { StatePanel } from "@/components/ui/primitives";
import { AlertIcon, InboxIcon, UsersIcon } from "@/components/ui/icons";
import { formatCount } from "@/lib/ui/format";
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
  titleKey: string;
  bodyKey: string;
  href: string;
};

const TONE_CLASSES: Record<NeedsAttentionCard["tone"], { surface: string; chip: string }> = {
  danger: { surface: "bg-danger/10", chip: "bg-danger/20 text-danger" },
  warning: { surface: "bg-warning/10", chip: "bg-warning/20 text-warning" },
  info: { surface: "bg-info/10", chip: "bg-info/20 text-info" },
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
      <div className="flex flex-col gap-0.5">
        <h2 id="needs-attention-heading" className="text-title text-fg">
          {t.title}
        </h2>
        <p className="text-label text-fg-muted">{t.subtitle}</p>
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
            const tone = TONE_CLASSES[card.tone];
            const title = t[card.titleKey as keyof typeof t].replace("{count}", formatCount(card.count, locale));
            const body = t[card.bodyKey as keyof typeof t];
            return (
              <li key={card.key}>
                <Link
                  href={card.href}
                  className={cn(
                    "flex h-full items-start gap-3 rounded-md p-md transition-colors hover:brightness-95",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                    tone.surface,
                  )}
                >
                  <span
                    className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-sm", tone.chip)}
                    aria-hidden="true"
                  >
                    <card.Icon size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body-lg font-semibold text-fg">{title}</span>
                    <span className="mt-0.5 block text-label text-fg-secondary">{body}</span>
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
