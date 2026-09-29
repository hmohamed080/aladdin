import { Badge, Card, StatePanel } from "@/components/ui/primitives";
import { Button, Input, LabeledField } from "@/components/ui/controls";
import { UsersIcon } from "@/components/ui/icons";
import { approveNetworkReferral, rejectNetworkReferral } from "@/server/actions/network-referrals";
import type { AdminNetworkReferralRow } from "@/server/queries/network-referrals";
import type { Messages } from "@/lib/i18n/messages/en";
import type { Locale } from "@/lib/i18n/locales";
import { formatCount, formatDate } from "@/lib/ui/format";

/**
 * Showrooms an installer/professional referred through "Add a showroom I
 * know" (`/home/network/refer`), on the EXISTING Admin verification surface
 * — the same review queue as `ReferralReview` (Sales referrals), not a
 * second Admin system: platform authority, the same approve/reject
 * vocabulary, the same audit trail (`network_referral.approved` /
 * `.rejected`, already wired in `network_referral_approve`/`_reject`).
 *
 * Only PENDING (`origin = 'new_showroom'`) referrals ever reach this list —
 * a referral to an organization already on Aladdin resolves to `joined` the
 * instant it is created and is never a review candidate, exactly as
 * `admin_network_referrals_list` documents.
 *
 * The de-duplication hint mirrors `ReferralReview`'s: a HINT for a human,
 * never an automatic merge, because two genuinely different showrooms may
 * share a name.
 */
export function NetworkReferralReview({
  rows,
  m,
  locale,
}: {
  rows: AdminNetworkReferralRow[];
  m: Messages;
  locale: Locale;
}) {
  const copy = m.admin.networkReferrals;
  const statusLabels = copy.status as Record<string, string>;

  return (
    <section className="flex flex-col gap-md">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-title text-fg">{copy.title}</h2>
        <p className="text-body text-fg-secondary">{copy.subtitle}</p>
      </div>

      {rows.length === 0 ? (
        <StatePanel title={copy.empty} icon={<UsersIcon size={20} />} />
      ) : (
        <ul className="flex flex-col gap-md">
          {rows.map((r) => {
            const location = [r.governorate, r.city].filter(Boolean).join(" · ");

            return (
              <li key={r.id}>
                <Card className="flex flex-col gap-md">
                  <div className="flex flex-wrap items-start justify-between gap-md">
                    <div className="flex min-w-0 flex-col gap-1">
                      <p className="text-body-lg font-semibold text-fg">
                        <bdi dir="auto">{r.displayName}</bdi>
                      </p>
                      {location ? (
                        <p className="text-label text-fg-secondary">
                          <bdi dir="auto">{location}</bdi>
                        </p>
                      ) : null}
                      {r.phone ? (
                        <p className="text-label text-fg-secondary">
                          {copy.phone}: {r.phone}
                        </p>
                      ) : null}
                      {r.note ? (
                        <p className="max-w-prose text-body text-fg-secondary">
                          <bdi dir="auto">{r.note}</bdi>
                        </p>
                      ) : null}
                      <p className="text-label text-fg-muted">{formatDate(r.createdAt, locale)}</p>
                    </div>
                    <Badge tone={r.status === "joined" ? "success" : r.status === "cancelled" ? "danger" : "info"}>
                      {statusLabels[r.status] ?? r.status}
                    </Badge>
                  </div>

                  {/* Attribution: who referred this showroom. */}
                  <div className="rounded-sm border border-strong bg-surface-2 px-3 py-2">
                    <p className="text-label text-fg-muted">{copy.referredBy}</p>
                    <p className="text-body text-fg">
                      {r.referrerName}
                      {r.referrerEmail ? ` · ${r.referrerEmail}` : ""}
                    </p>
                  </div>

                  {r.status === "pending" ? (
                    <div className="flex flex-col gap-md">
                      {r.matchId ? (
                        <div className="flex flex-col gap-sm rounded-sm border border-warning/40 bg-warning/10 px-3 py-2.5">
                          <p className="text-body font-medium text-fg">{copy.possibleDuplicate}</p>
                          <p className="text-body text-fg-secondary">
                            {copy.matches}: {r.matchName}
                            {r.matchCount > 1 ? ` (+${formatCount(r.matchCount - 1, locale)})` : ""}
                          </p>
                          <form action={approveNetworkReferral}>
                            <input type="hidden" name="referralId" value={r.id} />
                            <input type="hidden" name="linkOrganizationId" value={r.matchId} />
                            <Button type="submit">{copy.linkExisting}</Button>
                          </form>
                          <p className="text-label text-fg-muted">{copy.linkNote}</p>
                        </div>
                      ) : null}

                      <div className="grid gap-md tablet:grid-cols-2">
                        <form action={approveNetworkReferral} className="flex flex-col gap-sm">
                          <input type="hidden" name="referralId" value={r.id} />
                          <div>
                            <Button type="submit" variant={r.matchId ? "outline" : "primary"}>
                              {copy.approveNew}
                            </Button>
                          </div>
                          <p className="text-label text-fg-muted">{copy.approveNote}</p>
                        </form>

                        <form action={rejectNetworkReferral} className="flex flex-col gap-sm">
                          <input type="hidden" name="referralId" value={r.id} />
                          <LabeledField label={copy.reasonLabel} htmlFor={`netref-reason-${r.id}`}>
                            <Input id={`netref-reason-${r.id}`} name="reason" required maxLength={500} />
                          </LabeledField>
                          <div>
                            <Button type="submit" variant="outline">
                              {copy.reject}
                            </Button>
                          </div>
                        </form>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {r.organizationName ? (
                        <p className="text-body text-fg-secondary">
                          {copy.resultOrganization}: {r.organizationName}
                        </p>
                      ) : null}
                      {r.decisionReason ? (
                        <p className="text-body text-fg-secondary">
                          {copy.reasonLabel}: {r.decisionReason}
                        </p>
                      ) : null}
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
