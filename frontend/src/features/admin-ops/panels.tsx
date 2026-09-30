import Link from "next/link";
import type { Locale } from "@/lib/i18n/locales";
import type { getMessages } from "@/lib/i18n/translate";
import { formatAdminDateTime } from "@/lib/ui/format";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Card, SectionTitle, StatePanel } from "@/components/ui/primitives";
import { ButtonLink, Input, LabeledField, Textarea } from "@/components/ui/controls";
import { addNoteAction, createCaseAction, resolveDuplicateAction } from "@/server/actions/admin-operations";
import { localizedName } from "@/features/admin-preview/directory-mappers";
import type {
  AdminCase,
  AdminNote,
  DuplicateCandidate,
  DuplicateResolution,
  TimelineEvent,
} from "@/features/admin-preview/operations-mappers";

type Messages = ReturnType<typeof getMessages>;
type Subject = "user" | "organization";

function SubjectFields({ subjectType, subjectId }: { subjectType: Subject; subjectId: string }) {
  return (
    <>
      <input type="hidden" name="subjectType" value={subjectType} />
      <input type="hidden" name="subjectId" value={subjectId} />
    </>
  );
}

/* --------------------------------------------------------------------- notes */

/**
 * Admin Notes — real, append-only (Admin Core 1B-B). `notes === null` means the
 * caller cannot read notes (or the read failed): a locked state, never fixtures.
 */
export function NotesPanel({
  m,
  locale,
  subjectType,
  subjectId,
  notes,
  canCreate,
}: {
  m: Messages;
  locale: Locale;
  subjectType: Subject;
  subjectId: string;
  notes: AdminNote[] | null;
  canCreate: boolean;
}) {
  const t = m.admin.preview.ops.notes;
  return (
    <section className="flex flex-col gap-md">
      {canCreate ? (
        <div>
          <ConfirmDialog
            trigger={t.add}
            triggerVariant="accent"
            title={t.addTitle}
            body={t.addBody}
            confirmLabel={t.add}
            confirmVariant="accent"
            formAction={addNoteAction}
          >
            <SubjectFields subjectType={subjectType} subjectId={subjectId} />
            <LabeledField label={t.bodyLabel} htmlFor={`note-body-${subjectId}`}>
              <Textarea id={`note-body-${subjectId}`} name="body" rows={4} maxLength={4000} required />
            </LabeledField>
          </ConfirmDialog>
        </div>
      ) : null}
      {notes === null ? (
        <StatePanel title={t.locked} />
      ) : notes.length === 0 ? (
        <StatePanel title={t.empty} />
      ) : (
        <div className="flex flex-col gap-sm">
          {notes.map((n) => (
            <Card key={n.id} pad="sm" className="flex flex-col gap-1">
              <p className="whitespace-pre-line text-body text-fg">{n.body}</p>
              <p className="text-label text-fg-muted">
                {n.author?.displayName || m.admin.users.unnamed} · {formatAdminDateTime(n.createdAt, locale)} · {t.internalOnly}
              </p>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------------------- cases */

/** Internal Report / Case — a real Admin record (not the deferred support-ticket system). */
export function CasesPanel({
  m,
  locale,
  subjectType,
  subjectId,
  cases,
  canCreate,
  defaults,
}: {
  m: Messages;
  locale: Locale;
  subjectType: Subject;
  subjectId: string;
  cases: AdminCase[] | null;
  canCreate: boolean;
  defaults: { subject: string; name: string; phone: string; email: string };
}) {
  const rp = m.admin.preview.report;
  const t = m.admin.preview.ops.cases;
  return (
    <section className="flex flex-col gap-md">
      <Card className="flex flex-col gap-md">
        <SectionTitle>{rp.title}</SectionTitle>
        <p className="text-body text-fg-secondary">{rp.subtitle}</p>
        {canCreate ? (
          <div>
            <ConfirmDialog
              wide
              trigger={rp.open}
              triggerVariant="danger"
              title={rp.title}
              body={rp.subtitle}
              confirmLabel={rp.submit}
              confirmVariant="danger"
              formAction={createCaseAction}
            >
              <SubjectFields subjectType={subjectType} subjectId={subjectId} />
              <LabeledField label={rp.subject} htmlFor={`case-title-${subjectId}`}>
                <Input id={`case-title-${subjectId}`} name="title" defaultValue={defaults.subject} maxLength={200} required />
              </LabeledField>
              <div className="grid gap-md tablet:grid-cols-2">
                <LabeledField label={rp.name} htmlFor={`case-name-${subjectId}`}>
                  <Input id={`case-name-${subjectId}`} name="contactName" defaultValue={defaults.name} maxLength={120} />
                </LabeledField>
                <LabeledField label={rp.phone} htmlFor={`case-phone-${subjectId}`}>
                  <Input id={`case-phone-${subjectId}`} name="contactPhone" type="tel" dir="ltr" defaultValue={defaults.phone} maxLength={40} />
                </LabeledField>
              </div>
              <LabeledField label={rp.email} htmlFor={`case-email-${subjectId}`}>
                <Input id={`case-email-${subjectId}`} name="contactEmail" type="email" dir="ltr" defaultValue={defaults.email} maxLength={254} />
              </LabeledField>
              <LabeledField label={rp.details} htmlFor={`case-details-${subjectId}`}>
                <Textarea id={`case-details-${subjectId}`} name="details" rows={4} maxLength={4000} placeholder={rp.detailsPlaceholder} required />
              </LabeledField>
              <LabeledField label={rp.attachment} htmlFor={`case-attachment-${subjectId}`} hint={t.attachmentsDeferred}>
                <input id={`case-attachment-${subjectId}`} type="file" disabled className="text-label text-fg-muted" />
              </LabeledField>
            </ConfirmDialog>
          </div>
        ) : null}
      </Card>

      <SectionTitle>{t.listTitle}</SectionTitle>
      {cases === null ? (
        <StatePanel title={t.locked} />
      ) : cases.length === 0 ? (
        <StatePanel title={t.empty} />
      ) : (
        <div className="flex flex-col gap-sm">
          {cases.map((c) => (
            <Card key={c.id} pad="sm" className="flex flex-col gap-1.5">
              <p className="font-medium text-fg">{c.title}</p>
              <p className="whitespace-pre-line text-body text-fg-secondary">{c.details}</p>
              {c.contactName || c.contactPhone || c.contactEmail ? (
                <p className="text-label text-fg-secondary">
                  {[c.contactName, c.contactPhone, c.contactEmail].filter(Boolean).map((v, i) => (
                    <span key={i} dir={i === 0 ? undefined : "ltr"} className="me-2 inline-block">
                      {v}
                    </span>
                  ))}
                </p>
              ) : null}
              <p className="text-label text-fg-muted">
                {t.openedBy.replace("{name}", c.createdBy?.displayName || m.admin.users.unnamed)} · {formatAdminDateTime(c.createdAt, locale)}
              </p>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ timeline */

/** The Entity Timeline — human-readable combined history (never raw Audit). */
export function TimelineList({ m, locale, events }: { m: Messages; locale: Locale; events: TimelineEvent[] | null }) {
  const t = m.admin.preview.ops.timeline;
  const statusLabels = m.admin.status as Record<string, string>;
  const verificationTypes = m.admin.verificationType as Record<string, string>;
  const followUpTypes = m.admin.preview.users.followUpDialog.types as Record<string, string>;
  if (events === null) return <StatePanel title={m.admin.preview.directory.detailLoadError} />;
  if (events.length === 0) return <StatePanel title={t.empty} />;

  const detail = (e: TimelineEvent): string | null => {
    const d = e.data;
    if (e.kind === "verification_submitted") return verificationTypes[d.type ?? ""] ?? d.type ?? null;
    if (e.kind === "verification_decided")
      return [verificationTypes[d.type ?? ""] ?? d.type, statusLabels[d.status ?? ""] ?? d.status].filter(Boolean).join(" · ");
    if (e.kind === "membership_joined") return d.organization_name ?? null;
    if (e.kind === "member_joined") return d.display_name || null;
    if (e.kind === "suspended" || e.kind === "restored") return d.reason ?? null;
    if (e.kind === "follow_up_logged" || e.kind === "follow_up_completed") {
      const key = d.action_type === "verification_follow_up" ? "verificationFollowUp" : (d.action_type ?? "");
      return followUpTypes[key] ?? null;
    }
    if (e.kind === "case_opened") return d.title ?? null;
    if (e.kind === "duplicate_linked" || e.kind === "duplicate_dismissed") return d.other_organization_name ?? null;
    return null;
  };

  return (
    <ol className="flex flex-col gap-px overflow-hidden rounded-md border bg-surface">
      {events.map((e, i) => {
        const text = detail(e);
        return (
          <li key={`${e.kind}-${e.at}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 bg-surface px-md py-2.5 odd:bg-surface-2/30">
            <span className="font-medium text-fg">
              {e.kind === "duplicate_linked" && e.data.role === "canonical" ? t.duplicateLinkedHere : t.kinds[e.kind]}
            </span>
            {text ? <span className="text-label text-fg-secondary">· {text}</span> : null}
            {e.actor ? <span className="text-label text-fg-muted">· {t.by.replace("{name}", e.actor.displayName || m.admin.users.unnamed)}</span> : null}
            <span className="ms-auto text-label text-fg-muted">{formatAdminDateTime(e.at, locale)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------------------------------------------------------- duplicates */

/** Organization duplicates — detect → suggest → link-to-existing / dismiss (PD-006; no merge). */
export function DuplicatesPanel({
  m,
  locale,
  organizationId,
  candidates,
  resolutions,
  canResolve,
}: {
  m: Messages;
  locale: Locale;
  organizationId: string;
  candidates: DuplicateCandidate[];
  resolutions: DuplicateResolution[];
  canResolve: boolean;
}) {
  const t = m.admin.preview.ops.duplicates;
  const typeLabels = m.orgType as Record<string, string>;
  const resolveForm = (c: DuplicateCandidate, mode: "link" | "dismiss") => (
    <ConfirmDialog
      trigger={mode === "link" ? t.link : t.dismiss}
      triggerVariant={mode === "link" ? "accent" : "outline"}
      title={mode === "link" ? t.linkTitle : t.dismissTitle}
      body={mode === "link" ? t.linkBody : t.dismissBody}
      confirmLabel={mode === "link" ? t.link : t.dismiss}
      confirmVariant={mode === "link" ? "accent" : "primary"}
      formAction={resolveDuplicateAction}
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="otherId" value={c.id} />
      <input type="hidden" name="mode" value={mode} />
      <p className="text-body font-medium text-fg">{localizedName(c, locale)}</p>
      <LabeledField label={m.admin.preview.ops.suspend.reasonLabel} htmlFor={`dup-${mode}-${c.id}`}>
        <Textarea id={`dup-${mode}-${c.id}`} name="reason" rows={2} maxLength={500} required />
      </LabeledField>
    </ConfirmDialog>
  );

  return (
    <div className="flex flex-col gap-lg">
      <Card className="flex flex-col gap-md">
        <SectionTitle>{m.admin.preview.duplicates.title}</SectionTitle>
        {candidates.length === 0 ? (
          <p className="text-body text-fg-secondary">{t.none}</p>
        ) : (
          <div className="flex flex-col gap-sm">
            {candidates.map((c) => (
              <Card key={c.id} pad="sm" className="flex flex-wrap items-center justify-between gap-md">
                <div className="flex min-w-0 flex-col gap-1">
                  <Link href={`/admin/preview/organizations/${c.id}`} className="font-medium text-accent hover:underline">
                    {localizedName(c, locale)}
                  </Link>
                  <span className="flex flex-wrap items-center gap-1.5 text-label text-fg-muted">
                    <Badge tone={c.signal === "same_name" ? "warning" : "neutral"}>{c.signal === "same_name" ? t.sameName : t.similarName}</Badge>
                    {typeLabels[c.orgType] ?? c.orgType}
                  </span>
                </div>
                <div className="flex flex-wrap gap-sm">
                  <ButtonLink variant="outline" size="sm" href={`/admin/preview/organizations/${c.id}`}>
                    {m.admin.preview.duplicates.inspect}
                  </ButtonLink>
                  {canResolve ? (
                    <>
                      {resolveForm(c, "link")}
                      {resolveForm(c, "dismiss")}
                    </>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Card>

      {resolutions.length > 0 ? (
        <Card className="flex flex-col gap-sm">
          <SectionTitle>{t.resolutionsTitle}</SectionTitle>
          {resolutions.map((r) => {
            const name = localizedName(r.other, locale);
            const label =
              r.resolution === "not_duplicate"
                ? t.dismissedWith.replace("{name}", name)
                : r.role === "duplicate"
                  ? t.linkedTo.replace("{name}", name)
                  : t.linkedFrom.replace("{name}", name);
            return (
              <div key={r.id} className="flex flex-col gap-0.5 border-t pt-sm first:border-t-0 first:pt-0">
                <Link href={`/admin/preview/organizations/${r.other.id}`} className="text-body text-accent hover:underline">
                  {label}
                </Link>
                <p className="text-label text-fg-muted">
                  {r.reason} · {r.resolvedBy?.displayName || m.admin.users.unnamed} · {formatAdminDateTime(r.resolvedAt, locale)}
                </p>
              </div>
            );
          })}
        </Card>
      ) : null}
    </div>
  );
}
