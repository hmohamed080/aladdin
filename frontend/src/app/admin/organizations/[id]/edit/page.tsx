import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { requireAdminRoute } from "@/server/authorization/admin";
import { can } from "@/lib/permissions/admin";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { AdminHeader } from "@/features/admin/parts";
import { EditForm, type EditFormField } from "@/features/admin-edit/edit-form";
import { ORG_EDIT_FIELDS } from "@/lib/admin/edit/fields";
import { editOrganizationAction } from "@/server/actions/admin-edit";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = "name, name_ar, name_en, description, facebook_url, instagram_url, tiktok_url, website_url, primary_locale, timezone, logo_media_id";

/**
 * Admin edit of an organization's presentation details (Option A). Legal name, organization type, contact phone and email,
 * verification state, slug, ownership and status are neither shown here nor accepted by the action or the RPC.
 */
export default async function AdminOrganizationEditPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminRoute("/admin/organizations");
  const { id } = await params;
  if (!UUID.test(id) || !can(access, "organizations.edit")) notFound();
  const supabase = await getServerSupabase();
  const { data: org } = await supabase.from("organizations").select(COLUMNS).eq("id", id).is("deleted_at", null).maybeSingle();
  if (!org) notFound();

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const row = org as Record<string, unknown>;
  const fields: EditFormField[] = ORG_EDIT_FIELDS.map((f) => ({ ...f, value: (row[f.key] as string | null) ?? "" }));
  return (
    <div className="flex flex-col gap-lg">
      <Link href={`/admin/organizations/${id}`} className="text-label text-accent hover:underline">
        ← {m.admin.profileEdit.back}
      </Link>
      <AdminHeader locale={locale} title={m.admin.profileEdit.orgTitle} subtitle={m.admin.profileEdit.intro} />
      <EditForm
        subjectId={id}
        fields={fields}
        media={[{ key: "logo_media_id", labelKey: "admin.profileEdit.removeLogo", present: row.logo_media_id != null }]}
        action={editOrganizationAction}
      />
    </div>
  );
}
