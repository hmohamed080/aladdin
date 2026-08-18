import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getOrganizationDetail } from "@/server/queries/admin";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatDate } from "@/lib/ui/format";
import { AdminHeader, StatusBadge } from "@/features/admin/parts";
import { Card, Badge, Field, SectionTitle, StatePanel } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function AdminOrgDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const org = await getOrganizationDetail(supabase, id);
  if (!org) notFound();

  // An organization's classification, not a person's persona: separate label set.
  const typeLabels = m.orgType as Record<string, string>;
  const statusLabels = m.admin.status as Record<string, string>;

  return (
    <div className="flex flex-col gap-lg">
      <Link href="/admin/organizations" className="text-label text-accent hover:underline">
        ← {m.admin.orgs.title}
      </Link>
      <div className="flex flex-wrap items-center gap-md">
        <AdminHeader locale={locale} title={org.name} subtitle={typeLabels[org.orgType] ?? org.orgType} />
        <div className="flex items-center gap-2">
          <StatusBadge status={org.status} label={statusLabels[org.status] ?? org.status} />
          {org.isVerified ? <Badge tone="success">{m.admin.orgs.verified}</Badge> : null}
        </div>
      </div>

      <Card>
        <dl className="grid gap-md tablet:grid-cols-4">
          <Field label={m.admin.orgs.type}>{typeLabels[org.orgType] ?? org.orgType}</Field>
          <Field label={m.admin.orgs.status}>{statusLabels[org.status] ?? org.status}</Field>
          {/* Stated explicitly: an absent badge must not be read as "unknown". */}
          <Field label={m.admin.orgs.verification}>
            {org.isVerified ? m.admin.orgs.verified : m.admin.orgs.notVerified}
          </Field>
          <Field label={m.admin.orgs.created}>{formatDate(org.createdAt, locale)}</Field>
        </dl>
      </Card>

      <section className="grid gap-lg tablet:grid-cols-2">
        {/* min-w-0: a grid item defaults to min-width:auto and would otherwise
            refuse to shrink below its content, pushing the page sideways on a
            narrow viewport instead of letting the names truncate. */}
        <div className="flex min-w-0 flex-col gap-md">
          <SectionTitle>{m.admin.orgs.branches}</SectionTitle>
          {org.branches.length === 0 ? (
            <StatePanel title={m.admin.orgs.noBranches} />
          ) : (
            <div className="flex flex-col gap-sm">
              {org.branches.map((b) => (
                <Card key={b.id} pad="sm" className="flex items-center justify-between gap-md">
                  {/* A long name truncates; the status must never be pushed off-screen. */}
                  <span className="min-w-0 truncate font-medium text-fg">{b.name}</span>
                  <span className="shrink-0">
                    <Badge tone={b.isActive ? "success" : "neutral"}>
                      {b.isActive ? m.admin.orgs.branchActive : m.admin.orgs.branchInactive}
                    </Badge>
                  </span>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-md">
          <SectionTitle>{m.admin.orgs.membersHeading}</SectionTitle>
          {org.members.length === 0 ? (
            <StatePanel title={m.admin.orgs.noMembers} />
          ) : (
            <div className="flex flex-col gap-sm">
              {org.members.map((mem) => (
                <Card key={mem.membershipId} pad="sm" className="flex items-center justify-between gap-md">
                  <Link
                    href={`/admin/users/${mem.userId}`}
                    className="min-w-0 truncate font-medium text-accent hover:underline"
                  >
                    {mem.displayName || m.admin.users.unnamed}
                  </Link>
                  <span className="shrink-0">
                    <StatusBadge status={mem.status} label={statusLabels[mem.status] ?? mem.status} />
                  </span>
                </Card>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-md">
        <SectionTitle>{m.admin.orgs.verifications}</SectionTitle>
        {org.verifications.length === 0 ? (
          <StatePanel title={m.admin.orgs.noVerifications} />
        ) : (
          <div className="flex flex-col gap-sm">
            {org.verifications.map((v) => (
              <Card key={v.id} pad="sm" className="flex flex-wrap items-center justify-between gap-md">
                <div>
                  <p className="text-body font-medium text-fg">
                    {(m.admin.verificationType as Record<string, string>)[v.verificationType] ?? v.verificationType}
                  </p>
                  <p className="text-label text-fg-muted">{formatDate(v.submittedAt, locale)}</p>
                </div>
                <StatusBadge status={v.status} label={statusLabels[v.status] ?? v.status} />
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
