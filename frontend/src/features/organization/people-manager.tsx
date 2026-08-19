"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { Card, Badge, StatePanel } from "@/components/ui/primitives";
import { Button, SubmitButton, Input, Select, LabeledField } from "@/components/ui/controls";
import { UsersIcon, MailIcon, PhoneIcon, CopyIcon } from "@/components/ui/icons";
import {
  inviteMemberAction,
  assignRoleAction,
  assignBranchAction,
  setMemberStatusAction,
  type PeopleFormState,
} from "@/server/actions/organization-forms";
import { ROLE_PRESET_ORDER, capabilityGroups } from "@/lib/org/roles";
import type { OrgMember, OrgInvitation } from "@/server/queries/organization";
import { formatCount } from "@/lib/ui/format";

const INITIAL: PeopleFormState = { ok: false };

type Branch = { id: string; name: string };

function statusTone(status: string): "success" | "warning" | "neutral" | "danger" {
  if (status === "active" || status === "accepted") return "success";
  if (status === "invited" || status === "pending") return "warning";
  if (status === "revoked" || status === "expired") return "danger";
  return "neutral";
}

/**
 * Invite a colleague by EMAIL or by PHONE.
 *
 * WHY THE CHANNEL IS A CHOICE
 * The people a workshop, a showroom or a distributor actually needs in their
 * workspace — a branch salesperson, a fitter, a driver — are reachable on
 * WhatsApp and often have no work email. An email-only invite form makes adding
 * them impossible without inventing an address, which is where team setup stops.
 *
 * ONE FORM, ONE TARGET
 * The two channels are not two forms: the branch, the capabilities the invitee
 * lands with, expiry and single-use acceptance are all identical, and only the
 * address differs. So the channel is a segmented switch above a single field,
 * and only the field for the SELECTED channel is submitted — the database
 * requires exactly one target, and sending both would be an ambiguous row.
 *
 * WHAT WE DO NOT CLAIM
 * Email invitations are delivered by the existing email path. There is no SMS or
 * WhatsApp sending configured here, so a phone invitation is created and the
 * link is handed straight back for the manager to send through the channel they
 * already use with that person. It says "ready to send", never "sent" — a
 * success message for a message that was never dispatched would leave a manager
 * waiting on an invitee nobody ever contacted.
 */
function InvitePanel({ orgId, branches }: { orgId: string; branches: Branch[] }) {
  const { t } = useI18n();
  const [state, action] = useActionState(inviteMemberAction, INITIAL);
  const [channel, setChannel] = useState<"email" | "phone">("email");
  const link = state.inviteToken ? `/auth/invite/${state.inviteToken}` : null;

  return (
    <Card className="flex flex-col gap-md">
      <h2 className="text-body-lg font-semibold text-fg">{t("org.invite.title")}</h2>
      <form action={action} className="flex flex-col gap-md">
        <input type="hidden" name="orgId" value={orgId} />
        <input type="hidden" name="channel" value={channel} />

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-label font-medium text-fg-secondary">
            {t("org.invite.channelLabel")}
          </legend>
          <div role="radiogroup" aria-label={t("org.invite.channelLabel")} className="flex w-fit gap-1">
            {(
              [
                ["email", MailIcon],
                ["phone", PhoneIcon],
              ] as const
            ).map(([value, Icon]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={channel === value}
                onClick={() => setChannel(value)}
                data-testid={`invite-channel-${value}`}
                className={cn(
                  "flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-label font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
                  channel === value
                    ? "border-accent-solid/50 bg-accent-solid/15 text-accent"
                    : "border-transparent bg-surface-2/60 text-fg-secondary hover:bg-surface-2 hover:text-fg",
                )}
              >
                <Icon size={15} />
                {t(`org.invite.channel.${value}`)}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-md tablet:grid-cols-2">
          {channel === "email" ? (
            <LabeledField label={t("org.invite.email")} htmlFor="invite-email">
              <Input
                id="invite-email"
                name="email"
                type="email"
                inputMode="email"
                placeholder="name@example.com"
                required
              />
            </LabeledField>
          ) : (
            <LabeledField
              label={t("org.invite.phone")}
              htmlFor="invite-phone"
              hint={t("org.invite.phoneHint")}
            >
              {/* `dir="ltr"` on the input itself: a phone number is a Latin-digit
                  string with a leading +, and letting it inherit RTL moves the
                  plus to the wrong end and reorders what the manager typed. */}
              <Input
                id="invite-phone"
                name="phone"
                type="tel"
                dir="ltr"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+20 100 200 3040"
                required
              />
            </LabeledField>
          )}
          {branches.length > 0 ? (
            <LabeledField label={t("org.invite.branch")} htmlFor="invite-branch" optional={t("common.optional")}>
              <Select id="invite-branch" name="branchId" defaultValue="">
                <option value="">{t("org.invite.noBranch")}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </LabeledField>
          ) : null}
        </div>
        <div className="flex items-center gap-md">
          <SubmitButton pendingLabel={t("common.saving")}>{t("org.invite.submit")}</SubmitButton>
          {state.code && !state.ok ? <span className="text-label text-danger">{t(state.code)}</span> : null}
          {state.ok && !link ? <span className="text-label text-success">{t(state.code ?? "org.invite.sent")}</span> : null}
        </div>
      </form>
      {link ? <InviteLink link={link} channel={state.channel ?? "email"} /> : null}
    </Card>
  );
}

/**
 * The generated invitation link, with a one-press copy.
 *
 * On a phone invitation this is not a convenience, it is the delivery mechanism:
 * nothing was sent, and this link is the only way the invitee ever hears about
 * it. So the copy button is the primary action rather than a small affordance
 * beside a code block, and the hint says plainly which channel the manager still
 * has to use.
 *
 * The token is rendered and copied, never logged — it is a bearer credential for
 * the phone path, and a console line or a telemetry event carrying it would hand
 * organization membership to anyone reading logs.
 */
function InviteLink({ link, channel }: { link: string; channel: "email" | "phone" }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      // `navigator.clipboard` needs a secure context and a permission that can be
      // refused. A failed copy must not look like a successful one, so the
      // confirmation is only shown when the write actually resolved — the link
      // is selectable text either way, which is the fallback.
      await navigator.clipboard.writeText(new URL(link, window.location.origin).toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed bg-surface-2/40 p-md">
      <p className="text-label font-medium text-success">{t("org.invite.linkReady")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code dir="ltr" className="min-w-0 flex-1 select-all break-all text-label text-fg-secondary">
          {link}
        </code>
        <Button type="button" variant="outline" size="sm" onClick={copy} data-testid="invite-copy-link">
          <CopyIcon size={15} />
          {copied ? t("org.invite.copied") : t("org.invite.copy")}
        </Button>
      </div>
      <p className="text-label text-fg-muted">
        {channel === "phone" ? t("org.invite.phoneShareHint") : t("org.invite.linkHint")}
      </p>
    </div>
  );
}

/** Inline capability-preset (role) selector for a member. */
function RoleForm({ member }: { member: OrgMember }) {
  const { t } = useI18n();
  const [state, action] = useActionState(assignRoleAction, INITIAL);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="membershipId" value={member.membershipId} />
      <Select name="role" defaultValue="" aria-label={t("org.role.assign")} className="min-w-40">
        <option value="" disabled>
          {t("org.role.assign")}
        </option>
        {ROLE_PRESET_ORDER.map((key) => (
          <option key={key} value={key}>
            {t(`org.roles.${key}`)}
          </option>
        ))}
      </Select>
      <SubmitButton size="sm" variant="outline" pendingLabel={t("common.saving")}>
        {t("org.role.apply")}
      </SubmitButton>
      {state.code ? (
        <span className={`text-label ${state.ok ? "text-success" : "text-danger"}`}>{t(state.code)}</span>
      ) : null}
    </form>
  );
}

/** Inline branch-scope assignment for a member. */
function BranchForm({ member, branches }: { member: OrgMember; branches: Branch[] }) {
  const { t } = useI18n();
  const [state, action] = useActionState(assignBranchAction, INITIAL);
  if (branches.length === 0) return null;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="membershipId" value={member.membershipId} />
      <Select name="branchId" defaultValue="" aria-label={t("org.branch.assign")} className="min-w-40">
        <option value="" disabled>
          {t("org.branch.assign")}
        </option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>
      <SubmitButton size="sm" variant="outline" pendingLabel={t("common.saving")}>
        {t("org.branch.apply")}
      </SubmitButton>
      {state.code ? (
        <span className={`text-label ${state.ok ? "text-success" : "text-danger"}`}>{t(state.code)}</span>
      ) : null}
    </form>
  );
}

/** Suspend / reactivate / revoke controls. */
function StatusForm({ member }: { member: OrgMember }) {
  const { t } = useI18n();
  const [state, action] = useActionState(setMemberStatusAction, INITIAL);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="membershipId" value={member.membershipId} />
      {member.status === "active" ? (
        <Button type="submit" name="op" value="suspend" variant="ghost" size="sm">
          {t("org.status.suspend")}
        </Button>
      ) : null}
      {member.status === "suspended" ? (
        <Button type="submit" name="op" value="activate" variant="ghost" size="sm">
          {t("org.status.reactivate")}
        </Button>
      ) : null}
      {member.status !== "revoked" ? (
        <Button type="submit" name="op" value="revoke" variant="ghost" size="sm" className="text-danger">
          {t("org.status.revoke")}
        </Button>
      ) : null}
      {state.code ? (
        <span className={`text-label ${state.ok ? "text-success" : "text-danger"}`}>{t(state.code)}</span>
      ) : null}
    </form>
  );
}

export function PeopleManager({
  orgId,
  members,
  invitations,
  branches,
}: {
  orgId: string;
  members: OrgMember[];
  invitations: OrgInvitation[];
  branches: Branch[];
}) {
  const { t, locale } = useI18n();
  const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name ?? null;
  const [showAccepted, setShowAccepted] = useState(false);
  const openInvites = invitations.filter((i) => i.status === "pending" || i.status === "expired");
  const shownInvites = showAccepted ? invitations : openInvites;

  return (
    <div className="flex flex-col gap-xl">
      <InvitePanel orgId={orgId} branches={branches} />

      <section className="flex flex-col gap-md">
        <h2 className="text-title text-fg">
          {t("org.members.title")} <span className="text-fg-muted">({formatCount(members.length, locale)})</span>
        </h2>
        {members.length === 0 ? (
          <StatePanel title={t("org.members.empty")} icon={<UsersIcon size={22} />} />
        ) : (
          <div className="flex flex-col gap-md">
            {members.map((member) => (
              <Card key={member.membershipId} className="flex flex-col gap-md">
                <div className="flex flex-wrap items-start justify-between gap-md">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-body-lg font-semibold text-fg">
                        {member.displayName || t("org.members.unnamed")}
                      </p>
                      <Badge tone={statusTone(member.status)}>{t(`org.statusLabel.${member.status}`)}</Badge>
                      {/* A colleague may be a business-only identity with no
                          personal persona — show nothing rather than an empty
                          badge, since what matters here is their membership. */}
                      {member.accountType ? (
                        <Badge tone="neutral">{t(`accountType.${member.accountType}`)}</Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-label text-fg-muted">{member.emailMasked}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {member.branchIds.length === 0 ? (
                      <Badge tone="neutral">{t("org.branch.orgWide")}</Badge>
                    ) : (
                      member.branchIds.map((id) => (
                        <Badge key={id} tone="info">
                          {branchName(id) ?? t("org.branch.unknown")}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>

                {/* What this colleague can work on, in their own language.
                    Deliberately NOT the raw capability keys: `org.members.manage`
                    is an internal identifier that renders untranslated in Arabic,
                    means nothing to the manager reading it, and puts the
                    permission model on screen. The groups below are the same
                    information as WORK. Authorization is untouched — the RPCs
                    still check the keys themselves. */}
                <div>
                  <p className="text-label text-fg-muted">{t("org.modules")}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {(() => {
                      const groups = capabilityGroups(member.capabilities);
                      if (groups.length === 0) {
                        return <span className="text-label text-fg-muted">{t("org.noModules")}</span>;
                      }
                      return groups.map((g) => (
                        <Badge key={g} tone={g === "manage" ? "accent" : "neutral"}>
                          {t(`org.capabilityGroup.${g}`)}
                        </Badge>
                      ));
                    })()}
                  </div>
                </div>

                <div className="flex flex-col gap-2 border-t pt-md tablet:flex-row tablet:flex-wrap tablet:items-end">
                  <RoleForm member={member} />
                  <BranchForm member={member} branches={branches} />
                  <div className="tablet:ms-auto">
                    <StatusForm member={member} />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-md">
        <div className="flex flex-wrap items-center justify-between gap-md">
          <h2 className="text-title text-fg">
            {t("org.invites.title")} <span className="text-fg-muted">({formatCount(openInvites.length, locale)})</span>
          </h2>
          {invitations.length > openInvites.length ? (
            <Button variant="ghost" size="sm" onClick={() => setShowAccepted((v) => !v)}>
              {showAccepted ? t("org.invites.hideResolved") : t("org.invites.showAll")}
            </Button>
          ) : null}
        </div>
        {shownInvites.length === 0 ? (
          <StatePanel title={t("org.invites.empty")} />
        ) : (
          <div className="flex flex-col gap-sm">
            {shownInvites.map((inv) => (
              <Card key={inv.id} pad="sm" className="flex flex-wrap items-center justify-between gap-md">
                <div className="min-w-0">
                  {/* The channel is part of the identity of an open invitation:
                      chasing one sent to a phone means opening WhatsApp, and
                      chasing one sent to an email means checking a mailbox. A
                      masked contact alone does not tell a manager which. */}
                  <p className="flex min-w-0 items-center gap-1.5 text-body font-medium text-fg">
                    <span className="shrink-0 text-fg-muted">
                      {inv.channel === "phone" ? <PhoneIcon size={15} /> : <MailIcon size={15} />}
                    </span>
                    <span dir="ltr" className="truncate">
                      {inv.contactMasked}
                    </span>
                  </p>
                  <p className="text-label text-fg-muted">
                    {branchName(inv.primaryBranchId) ?? t("org.branch.orgWide")}
                  </p>
                </div>
                <div className="flex items-center gap-md">
                  {inv.status === "pending" ? (
                    <code className="hidden max-w-56 select-all truncate text-label text-fg-muted desktop:inline">
                      /auth/invite/{inv.token}
                    </code>
                  ) : null}
                  <Badge tone={statusTone(inv.status)}>{t(`org.inviteStatus.${inv.status}`)}</Badge>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
