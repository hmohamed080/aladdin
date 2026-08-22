import { Badge, Card, StatePanel } from "@/components/ui/primitives";
import { Button, Input, LabeledField, Select } from "@/components/ui/controls";
import { UsersIcon } from "@/components/ui/icons";
import { approveJoinRequest, rejectJoinRequest } from "@/server/actions/affiliation";
import type { JoinRequestRow } from "@/server/queries/affiliation";
import type { Messages } from "@/lib/i18n/messages/en";
import type { Locale } from "@/lib/i18n/locales";
import { formatCount } from "@/lib/ui/format";

/**
 * Affiliation requests, on the organization's EXISTING people surface.
 *
 * Deliberately not a separate approval console: the decision belongs to the same
 * Owner/Manager who already runs the roster, gated on the same
 * `org.members.manage` capability, so there is one place people join a business and
 * one permission model behind it. Approving activates a SALES membership through
 * the shared trusted path — the same one an accepted invitation uses.
 *
 * Server-rendered forms, so approve/reject work without client JavaScript and
 * cannot be double-fired into a duplicate membership (the RPC is idempotent too).
 */
export function JoinRequests({
  requests,
  branches,
  m,
  locale,
}: {
  requests: JoinRequestRow[];
  branches: { id: string; name: string }[];
  m: Messages;
  locale: Locale;
}) {
  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");
  const personaLabels = m.accountType as Record<string, string>;
  const statusLabels = m.org.joinRequests.status as Record<string, string>;

  return (
    <section className="flex flex-col gap-md">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-title text-fg">{m.org.joinRequests.title}</h2>
        <p className="text-body text-fg-secondary">{m.org.joinRequests.subtitle}</p>
      </div>

      {pending.length === 0 ? (
        <StatePanel
          title={m.org.joinRequests.empty}
          body={m.org.joinRequests.emptyBody}
          icon={<UsersIcon size={20} />}
        />
      ) : (
        <ul className="flex flex-col gap-md">
          {pending.map((r) => (
            <li key={r.requestId}>
              <Card className="flex flex-col gap-md">
                <div className="flex flex-wrap items-start justify-between gap-md">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-body-lg font-semibold text-fg">{r.displayName}</p>
                      {r.persona ? (
                        <Badge tone="neutral">{personaLabels[r.persona] ?? r.persona}</Badge>
                      ) : null}
                    </div>
                    <p className="text-label text-fg-secondary">{r.emailMasked}</p>
                    {r.branchName ? (
                      <p className="text-label text-fg-secondary">
                        {m.org.joinRequests.requestedBranch}: {r.branchName}
                      </p>
                    ) : null}
                    {r.note ? <p className="max-w-prose text-body text-fg-secondary">“{r.note}”</p> : null}
                  </div>
                  <Badge tone="info">{statusLabels.pending}</Badge>
                </div>

                <div className="grid gap-md tablet:grid-cols-2">
                  {/* Approve: the manager may confirm or override the branch. */}
                  <form action={approveJoinRequest} className="flex flex-col gap-sm">
                    <input type="hidden" name="requestId" value={r.requestId} />
                    {branches.length > 0 ? (
                      <LabeledField
                        label={m.org.joinRequests.branchLabel}
                        htmlFor={`branch-${r.requestId}`}
                        hint={m.org.joinRequests.branchHint}
                      >
                        <Select
                          id={`branch-${r.requestId}`}
                          name="branchId"
                          defaultValue={r.branchId ?? ""}
                        >
                          <option value="">{m.org.joinRequests.branchPrimary}</option>
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </Select>
                      </LabeledField>
                    ) : null}
                    <div>
                      <Button type="submit">{m.org.joinRequests.approve}</Button>
                    </div>
                    <p className="text-label text-fg-muted">{m.org.joinRequests.approveNote}</p>
                  </form>

                  {/* Reject: a reason is required, and the salesperson sees it. */}
                  <form action={rejectJoinRequest} className="flex flex-col gap-sm">
                    <input type="hidden" name="requestId" value={r.requestId} />
                    <LabeledField
                      label={m.org.joinRequests.reasonLabel}
                      htmlFor={`reason-${r.requestId}`}
                      hint={m.org.joinRequests.reasonHint}
                    >
                      <Input id={`reason-${r.requestId}`} name="reason" required maxLength={500} />
                    </LabeledField>
                    <div>
                      <Button type="submit" variant="outline">
                        {m.org.joinRequests.reject}
                      </Button>
                    </div>
                  </form>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {decided.length > 0 ? (
        <details className="rounded-md border bg-surface p-md">
          <summary className="cursor-pointer text-body font-medium text-fg">
            {m.org.joinRequests.history} ({formatCount(decided.length, locale)})
          </summary>
          <ul className="mt-md flex flex-col gap-sm">
            {decided.map((r) => (
              <li key={r.requestId} className="flex flex-wrap items-center justify-between gap-sm">
                <span className="text-body text-fg">{r.displayName}</span>
                <span className="flex items-center gap-sm">
                  {r.reason ? <span className="text-label text-fg-muted">{r.reason}</span> : null}
                  <Badge tone={r.status === "approved" ? "success" : "neutral"}>
                    {statusLabels[r.status] ?? r.status}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
