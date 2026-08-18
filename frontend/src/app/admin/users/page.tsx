import Link from "next/link";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { listUsers } from "@/server/queries/admin";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatDate } from "@/lib/ui/format";
import { AdminHeader, StatusBadge, TableScroll } from "@/features/admin/parts";
import { StatePanel } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const { q } = await searchParams;
  const users = await listUsers(supabase, q);
  const typeLabels = m.accountType as Record<string, string>;
  const statusLabels = m.admin.status as Record<string, string>;

  return (
    <div className="flex flex-col gap-lg">
      <AdminHeader locale={locale} title={m.admin.users.title} subtitle={m.admin.users.subtitle} count={users.length} />

      <form method="get" className="flex gap-sm">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder={m.admin.users.searchPlaceholder}
          className="min-h-10 w-full max-w-sm rounded-md border border-strong bg-canvas px-3.5 text-body text-fg placeholder:text-fg-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40"
        />
        <button type="submit" className="rounded-sm bg-surface-2 px-4 text-label font-medium text-fg">
          {m.admin.users.search}
        </button>
      </form>

      {users.length === 0 ? (
        <StatePanel title={m.admin.users.empty} />
      ) : (
        <TableScroll>
          <thead>
            <tr className="border-b bg-surface-2/40 text-label text-fg-muted">
              <th className="px-md py-2 text-start font-medium">{m.admin.users.name}</th>
              <th className="px-md py-2 text-start font-medium">{m.admin.users.type}</th>
              <th className="px-md py-2 text-start font-medium">{m.admin.users.status}</th>
              <th className="px-md py-2 text-start font-medium">{m.admin.users.joined}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b last:border-0 hover:bg-surface-2/30">
                <td className="px-md py-2.5">
                  <Link href={`/admin/users/${u.id}`} className="font-medium text-accent hover:underline">
                    {u.displayName || m.admin.users.unnamed}
                  </Link>
                </td>
                <td className="px-md py-2.5 text-fg-secondary">
                  {u.accountType
                    ? (typeLabels[u.accountType] ?? u.accountType)
                    : m.admin.users.businessOnly}
                </td>
                <td className="px-md py-2.5">
                  <StatusBadge status={u.status} label={statusLabels[u.status] ?? u.status} />
                </td>
                <td className="px-md py-2.5 text-label text-fg-muted">{formatDate(u.createdAt, locale)}</td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      )}
    </div>
  );
}
