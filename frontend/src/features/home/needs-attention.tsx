import Link from "next/link";
import type { Locale } from "@/lib/i18n/locales";
import type { Messages } from "@/lib/i18n/messages/en";
import { StatePanel } from "@/components/ui/primitives";
import { AlertIcon, InboxIcon, UsersIcon } from "@/components/ui/icons";
import { formatCompactMoney, formatDateShort } from "@/lib/ui/format";
import type { FollowUpRow } from "@/server/queries/sales";
import type { QuotationListRow } from "@/server/queries/commerce";
import type { JoinRequestRow } from "@/server/queries/affiliation";

/**
 * "يحتاج تدخلك اليوم" — a short, prioritized list of genuinely actionable
 * state, never a second inbox. Three real, already-authorized record types
 * (overdue follow-ups, quotations awaiting this org's decision, pending
 * requests to join this org's team), each item deep-linking straight to the
 * page that can act on it. This component itself never mutates anything —
 * approving a join request or deciding a quotation both stay on their own
 * pages, exactly where the rest of the product already does that work.
 *
 * Tone is StatePanel/EmptyLine-quiet, not red-everywhere: a small icon per
 * row, no alarm color wash. `AlertIcon`/`InboxIcon`/`UsersIcon` are the same
 * glyphs the KPI tiles already use for the same three concepts, so this
 * section and نظرة على يومك read as one vocabulary, not two.
 *
 * All three lists arrive pre-fetched, pre-scoped props — this component
 * decides nothing about authorization or tenancy, only how to lay out
 * whatever its caller already resolved through RLS-scoped queries.
 */
export function NeedsAttentionSection({
  overdueFollowUps,
  quotationsAwaitingDecision,
  pendingJoinRequests,
  locale,
  m,
}: {
  overdueFollowUps: FollowUpRow[];
  quotationsAwaitingDecision: QuotationListRow[];
  pendingJoinRequests: JoinRequestRow[];
  locale: Locale;
  m: Messages;
}) {
  const t = m.home.needsAttention;
  const totalCount = overdueFollowUps.length + quotationsAwaitingDecision.length + pendingJoinRequests.length;

  return (
    <section className="flex flex-col gap-md" aria-labelledby="needs-attention-heading">
      <div className="flex flex-col gap-0.5">
        <h2 id="needs-attention-heading" className="text-title text-fg">
          {t.title}
        </h2>
        <p className="text-label text-fg-muted">{t.subtitle}</p>
      </div>

      {totalCount === 0 ? (
        <StatePanel title={t.emptyTitle} body={t.emptyBody} tone="neutral" />
      ) : (
        <ul className="flex flex-col gap-sm">
          {overdueFollowUps.map((f) => (
            <li key={`followup-${f.id}`}>
              <Link
                href={`/b2b/follow-ups/${f.id}/edit`}
                className="flex items-center gap-3 rounded-md border bg-surface p-md transition-colors hover:bg-surface-2/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-danger/15 text-danger"
                  aria-hidden="true"
                >
                  <AlertIcon size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-label text-fg-muted">{t.overdueFollowUp}</span>
                  {/* `dir="auto"` — this title is the CUSTOMER'S own free text, not
                      app copy, and it sits inside an ambient RTL page in Arabic. Without
                      an explicit direction, the browser's bidi algorithm lays an
                      undirected Latin run out inside the surrounding RTL flow and clips
                      `truncate`'s single-line overflow from the wrong (logical-start)
                      edge — an English title reads "…ha back with the tile options"
                      with its OWN beginning gone, never its end. `dir="auto"` picks the
                      run's real direction from its first strong character (Arabic stays
                      RTL, Latin renders properly LTR) independent of the page's own
                      direction. `line-clamp-2` (not `truncate`) is the second half of
                      the fix: a real title can run long in either script, and wrapping
                      it onto a second line loses nothing a single clipped line already
                      lost — it only stops needing an ellipsis at all until genuinely
                      long. */}
                  <span dir="auto" className="block line-clamp-2 break-words text-body font-medium text-fg">
                    {f.title}
                  </span>
                </span>
                {f.due_at ? (
                  <span className="shrink-0 text-label text-fg-muted">{formatDateShort(f.due_at, locale)}</span>
                ) : null}
              </Link>
            </li>
          ))}

          {quotationsAwaitingDecision.map((q) => (
            <li key={`quotation-${q.id}`}>
              <Link
                href={`/b2b/quotations/${q.id}`}
                className="flex items-center gap-3 rounded-md border bg-surface p-md transition-colors hover:bg-surface-2/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-accent-solid/15 text-accent"
                  aria-hidden="true"
                >
                  <InboxIcon size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-label text-fg-muted">{t.quotationAwaitingDecision}</span>
                  {/* Same `dir="auto"` + `line-clamp-2` fix as the follow-up title
                      above — an RFQ title is equally free text, equally likely to be
                      English inside the Arabic UI. */}
                  <span dir="auto" className="block line-clamp-2 break-words text-body font-medium text-fg">
                    {q.rfq_title ?? q.supplier_name ?? q.id}
                  </span>
                </span>
                {typeof q.total === "number" ? (
                  <span className="shrink-0 text-label text-fg-muted">{formatCompactMoney(q.total, locale)}</span>
                ) : null}
              </Link>
            </li>
          ))}

          {pendingJoinRequests.map((r) => (
            <li key={`join-request-${r.requestId}`}>
              <Link
                href="/b2b/organization"
                className="flex items-center gap-3 rounded-md border bg-surface p-md transition-colors hover:bg-surface-2/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-info/15 text-info"
                  aria-hidden="true"
                >
                  <UsersIcon size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-label text-fg-muted">{t.pendingJoinRequest}</span>
                  {/* Same fix — a person's real name is exactly the same kind of
                      free text an English or mixed-script title is. */}
                  <span dir="auto" className="block line-clamp-2 break-words text-body font-medium text-fg">
                    {r.displayName}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
