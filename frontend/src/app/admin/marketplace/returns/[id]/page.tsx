import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { requireAdminRoute } from "@/server/authorization/admin";
import { ReturnDetail } from "@/features/marketplace-returns/return-view";
import type { ReturnDocument } from "@/features/marketplace-returns/contract";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function AdminReturnRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  await requireAdminRoute(`/admin/marketplace/returns/${id}`);
  const supabase = await getServerSupabase();
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const { data } = await supabase.rpc("admin_marketplace_return_get", { p_return_id: id });
  if (!data) notFound();
  const doc = ((data as { return?: ReturnDocument }).return ?? data) as ReturnDocument;
  return <ReturnDetail doc={doc} role="admin" locale={locale} />;
}
