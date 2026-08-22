import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { listAudit } from "@/server/queries/admin";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { AdminHeader } from "@/features/admin/parts";
import { AuditFeed } from "@/features/admin/audit-feed";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const entries = await listAudit(supabase, 60);

  return (
    <div className="flex flex-col gap-lg">
      <AdminHeader locale={locale} title={m.admin.audit.title} subtitle={m.admin.audit.subtitle} count={entries.length} />
      <AuditFeed entries={entries} locale={locale} />
    </div>
  );
}
