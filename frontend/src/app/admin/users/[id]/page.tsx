import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getUserDetail } from "@/server/queries/admin";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatDate } from "@/lib/ui/format";
import { AdminHeader, StatusBadge } from "@/features/admin/parts";
import { Card, Badge, Field, SectionTitle, StatePanel } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const user = await getUserDetail(supabase, id);
  if (!user) notFound();

  const typeLabels = m.accountType as Record<string, string>;
  const statusLabels = m.admin.status as Record<string, string>;

  return (
    <div className="flex flex-col gap-lg">
      <Link href="/admin/users" className="text-label text-accent hover:underline">
        ← {m.admin.users.title}
      </Link>
      <div className="flex flex-wrap items-center gap-md">
        <AdminHeader title={user.displayName || m.admin.users.unnamed} subtitle={user.headline ?? undefined} />
        <div className="flex items-center gap-2">
          <StatusBadge status={user.status} label={statusLabels[user.status] ?? user.status} />
          {user.isVerified ? <Badge tone="success">{m.admin.users.verified}</Badge> : null}
        </div>
      </div>

      <Card>
        <dl className="grid gap-md tablet:grid-cols-3">
          <Field label={m.admin.users.type}>{typeLabels[user.accountType] ?? user.accountType}</Field>
          <Field label={m.admin.users.status}>{statusLabels[user.status] ?? user.status}</Field>
          <Field label={m.admin.users.joined}>{formatDate(user.createdAt, locale)}</Field>
        </dl>
      </Card>

      <section className="flex flex-col gap-md">
        <SectionTitle>{m.admin.users.memberships}</SectionTitle>
        {user.memberships.length === 0 ? (
          <StatePanel title={m.admin.users.noMemberships} />
        ) : (
          <div className="flex flex-col gap-sm">
            {user.memberships.map((mm) => (
              <Card key={mm.membershipId} pad="sm" className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-md">
                  <Link href={`/admin/organizations/${mm.orgId}`} className="font-medium text-accent hover:underline">
                    {mm.orgName}
                  </Link>
                  <StatusBadge status={mm.status} label={statusLabels[mm.status] ?? mm.status} />
                </div>
                {mm.capabilities.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {mm.capabilities.map((c) => (
                      <span key={c} className="rounded-pill bg-surface-2 px-2 py-0.5 text-label text-fg-secondary">
                        {c}
                      </span>
                    ))}
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-md">
        <SectionTitle>{m.admin.users.verifications}</SectionTitle>
        {user.verifications.length === 0 ? (
          <StatePanel title={m.admin.users.noVerifications} />
        ) : (
          <div className="flex flex-col gap-sm">
            {user.verifications.map((v) => (
              <Card key={v.id} pad="sm" className="flex flex-wrap items-center justify-between gap-md">
                <div>
                  <p className="text-body font-medium text-fg">
                    {(m.admin.verificationType as Record<string, string>)[v.verificationType] ?? v.verificationType}
                    {v.requestedAccountType ? ` → ${typeLabels[v.requestedAccountType] ?? v.requestedAccountType}` : ""}
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
