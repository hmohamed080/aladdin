import Link from "next/link";
import { Panel } from "@/components/ui/workspace-layout";
import { StatePanel } from "@/components/ui/primitives";
import { Monogram } from "@/components/ui/data-table";
import { InboxIcon } from "@/components/ui/icons";
import { ResendButton } from "./resend-button";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { formatDate } from "@/lib/ui/format";
import type { NetworkReferral } from "@/server/queries/network-referrals";

/**
 * Pending Invitations — a preview of the caller's own pending referrals
 * (revisit §13), not the full list: the Network Directory's own "Pending
 * invitations" tab is that. Resend is real (`ResendButton`); withdrawing a
 * referral stays a Directory action, since this preview is meant to stay
 * compact rather than grow the same overflow menu the full row carries.
 *
 * `fill` + `foot` anchors "View all invitations (N)" to the bottom of the
 * panel regardless of how many rows are above it, which is what lets this
 * panel share a bottom edge with the Network Directory beside it (§15).
 */
export function PendingInvitationsPanel({
  pendingReferrals,
  pendingTotal,
  t,
  locale,
}: {
  /** A short preview (2–3 rows) — never the full list. */
  pendingReferrals: readonly NetworkReferral[];
  /** The REAL total pending count, so the preview and "view all" never disagree. */
  pendingTotal: number;
  t: TranslateFn;
  locale: Locale;
}) {
  return (
    <Panel
      title={t("network.rail.pendingTitle")}
      Icon={InboxIcon}
      badge={pendingTotal > 0 ? String(pendingTotal) : undefined}
      fill
      bodyClassName={pendingReferrals.length > 0 ? "flex-1 p-0" : "flex-1"}
      foot={
        pendingTotal > 0 ? (
          <Link
            href="/home/network?tab=pending"
            className="block text-center text-label font-medium text-accent hover:underline"
          >
            {t("network.rail.viewAllPendingCount", { n: pendingTotal })}
          </Link>
        ) : undefined
      }
    >
      {pendingReferrals.length === 0 ? (
        <StatePanel title={t("network.rail.pendingEmpty")} />
      ) : (
        <ul className="flex flex-col divide-y">
          {pendingReferrals.map((r) => (
            <li key={r.id} className="flex items-center gap-2 px-md py-sm">
              <Monogram name={r.displayName ?? "—"} size={26} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-label font-medium text-fg">
                  <bdi dir="auto">{r.displayName}</bdi>
                </p>
                <p className="truncate text-caption text-fg-muted">
                  {[r.governorate, r.city].filter(Boolean).join(" · ")} · {formatDate(r.createdAt, locale)}
                </p>
              </div>
              <ResendButton name={r.displayName ?? ""} variant="icon" />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
