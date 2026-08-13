import Link from "next/link";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { listOrganizations } from "@/server/queries/admin";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatDate } from "@/lib/ui/format";
import { AdminHeader, StatusBadge, TableScroll } from "@/features/admin/parts";
import { Badge, StatePanel } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function AdminOrganizationsPage() {
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const orgs = await listOrganizations(supabase);
  // An organization's classification, not a person's persona: separate label set.
  const typeLabels = m.orgType as Record<string, string>;
  const statusLabels = m.admin.status as Record<string, string>;

  return (
    <div className="flex flex-col gap-lg">
      <AdminHeader title={m.admin.orgs.title} subtitle={m.admin.orgs.subtitle} count={orgs.length} />
      {orgs.length === 0 ? (
        <StatePanel title={m.admin.orgs.empty} />
      ) : (
        <TableScroll>
          <thead>
            <tr className="border-b bg-surface-2/40 text-label text-fg-muted">
              <th className="px-md py-2 text-start font-medium">{m.admin.orgs.name}</th>
              <th className="px-md py-2 text-start font-medium">{m.admin.orgs.type}</th>
              <th className="px-md py-2 text-start font-medium">{m.admin.orgs.status}</th>
              <th className="px-md py-2 text-start font-medium">{m.admin.orgs.members}</th>
              <th className="px-md py-2 text-start font-medium">{m.admin.orgs.created}</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id} className="border-b last:border-0 hover:bg-surface-2/30">
                <td className="px-md py-2.5">
                  <Link href={`/admin/organizations/${o.id}`} className="font-medium text-accent hover:underline">
                    {o.name}
                  </Link>
                  {o.isVerified ? <Badge tone="success">✓</Badge> : null}
                </td>
                <td className="px-md py-2.5 text-fg-secondary">{typeLabels[o.orgType] ?? o.orgType}</td>
                <td className="px-md py-2.5">
                  <StatusBadge status={o.status} label={statusLabels[o.status] ?? o.status} />
                </td>
                <td className="px-md py-2.5 text-fg-secondary">{o.memberCount}</td>
                <td className="px-md py-2.5 text-label text-fg-muted">{formatDate(o.createdAt, locale)}</td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      )}
    </div>
  );
}
