import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadPlatformRole } from "@/server/queries/platform";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { AdminHeader } from "@/features/admin/parts";
import { Card, SectionTitle, Badge, Field } from "@/components/ui/primitives";
import { LabeledField, Input, ButtonLink } from "@/components/ui/controls";
import { Monogram } from "@/components/ui/data-table";
import { PreviewActionDialog } from "@/features/admin-preview/preview-action-dialog";

export const dynamic = "force-dynamic";

/**
 * Phase 0C — Admin Settings (new page). Uses the reference implementation's
 * own Settings screen as UX inspiration only. The "Sign-in & Security"
 * section states the real mechanism: canonical Email + Password auth (root
 * `CLAUDE.md` Authentication model, 2026-09-28). An in-Admin password-change
 * form is not built yet. Never expose credentials; no backend wiring happens
 * on this page.
 */
export default async function PreviewSettingsPage() {
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const st = m.admin.preview.settings;

  const [{ data: authData }, role] = await Promise.all([supabase.auth.getUser(), loadPlatformRole(supabase)]);
  const authUser = authData.user;
  let displayName = "";
  if (authUser) {
    const { data: profile } = await supabase.from("profiles").select("display_name").eq("user_id", authUser.id).maybeSingle();
    displayName = profile?.display_name ?? "";
  }

  return (
    <div className="flex flex-col gap-lg">
      <AdminHeader locale={locale} title={st.title} subtitle={st.subtitle} />

      <Card className="flex flex-col gap-md">
        <SectionTitle>{st.profileTitle}</SectionTitle>
        <div className="flex items-center gap-md">
          <Monogram name={displayName || "?"} size={56} />
          <PreviewActionDialog trigger={st.changePhoto} triggerVariant="outline" title={st.changePhoto} confirmLabel={st.changePhoto} confirmVariant="accent" />
        </div>
        <dl className="grid gap-md tablet:grid-cols-2">
          <LabeledField label={st.fullName} htmlFor="settings-name">
            <Input id="settings-name" defaultValue={displayName} />
          </LabeledField>
          <Field label={st.role}>
            <Badge tone="accent">{role ? m.admin.roleLabel[role] : "—"}</Badge>
          </Field>
          <LabeledField label={st.phone} htmlFor="settings-phone">
            <Input id="settings-phone" dir="ltr" defaultValue={authUser?.phone ?? ""} placeholder={st.notProvided} />
          </LabeledField>
          <LabeledField label={st.email} htmlFor="settings-email">
            <Input id="settings-email" dir="ltr" defaultValue={authUser?.email ?? ""} disabled />
          </LabeledField>
        </dl>
        <p className="text-label text-fg-muted">{st.emailChangeNote}</p>
        <div className="flex justify-end">
          <PreviewActionDialog trigger={st.saveProfile} triggerVariant="accent" title={st.saveProfile} confirmLabel={st.saveProfile} confirmVariant="accent" />
        </div>
      </Card>

      <Card className="flex flex-col gap-md">
        <SectionTitle>{st.securityTitle}</SectionTitle>
        <p className="text-body text-fg-secondary">{st.securityBody}</p>
        <div className="flex flex-wrap gap-sm">
          <ButtonLink variant="outline" size="sm" href="/admin/preview/staff">
            {st.viewAdminStaff}
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}
