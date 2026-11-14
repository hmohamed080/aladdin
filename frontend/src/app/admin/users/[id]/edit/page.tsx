import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/session";
import { requireAdminRoute } from "@/server/authorization/admin";
import { loadStaffRanks } from "@/server/queries/admin-rbac";
import { canEditUser, staffRankOf } from "@/features/admin-rbac/eligibility";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { AdminHeader } from "@/features/admin/parts";
import { EditForm, type EditFormField } from "@/features/admin-edit/edit-form";
import { USER_EDIT_FIELDS } from "@/lib/admin/edit/fields";
import { editUserProfileAction } from "@/server/actions/admin-edit";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS =
  "display_name, display_name_ar, display_name_en, headline, bio, languages, governorate_key, city_key, city_custom_name, available_for_work, avatar_media_id, cover_media_id";

/**
 * Admin edit of a user's presentation details (Option A). A dedicated, explicit page: the form lives nowhere inside View-As
 * (which stays strictly read-only). Contact and legal data are neither shown here nor accepted by the action or the RPC.
 */
export default async function AdminUserEditPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminRoute("/admin/users");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await getServerSupabase();
  const caller = await getCurrentUser();
  const staffRanks = await loadStaffRanks(supabase, access);
  if (!canEditUser(access, caller?.id ?? "", { userId: id, staffRank: staffRankOf(staffRanks, id) })) notFound();

  const { data: profile } = await supabase.from("profiles").select(COLUMNS).eq("user_id", id).is("deleted_at", null).maybeSingle();
  if (!profile) notFound();

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const row = profile as Record<string, unknown>;
  const fields: EditFormField[] = USER_EDIT_FIELDS.map((f) => ({
    ...f,
    value: f.kind === "boolean" ? row[f.key] === true : f.kind === "languages" ? ((row[f.key] as string[] | null) ?? []).join(", ") : ((row[f.key] as string | null) ?? ""),
  }));
  return (
    <div className="flex flex-col gap-lg">
      <Link href={`/admin/users/${id}`} className="text-label text-accent hover:underline">
        ← {m.admin.profileEdit.back}
      </Link>
      <AdminHeader locale={locale} title={m.admin.profileEdit.userTitle} subtitle={m.admin.profileEdit.intro} />
      <EditForm
        subjectId={id}
        fields={fields}
        media={[
          { key: "avatar_media_id", labelKey: "admin.profileEdit.removeAvatar", present: row.avatar_media_id != null },
          { key: "cover_media_id", labelKey: "admin.profileEdit.removeCover", present: row.cover_media_id != null },
        ]}
        action={editUserProfileAction}
      />
    </div>
  );
}
