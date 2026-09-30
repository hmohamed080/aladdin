import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { AdminHeader } from "@/features/admin/parts";
import { Card, SectionTitle, Badge, Field } from "@/components/ui/primitives";
import { LabeledField, Input, ButtonLink } from "@/components/ui/controls";
import { Monogram } from "@/components/ui/data-table";
import { PreviewActionDialog } from "@/features/admin-preview/preview-action-dialog";
import { ChangePasswordPreview } from "@/features/admin-preview/change-password-preview";
import { requireAdminRoute } from "@/server/authorization/admin";

export const dynamic = "force-dynamic";

/**
 * Admin Settings — Phase 0D. Two sections:
 *
 *  1. **Profile** — Photo · Full Name · Username · Phone · Email. Name, username
 *     and phone are the signed-in Admin's own real values (`auth.getUser()` +
 *     `profiles`); Save is a Preview dialog and never writes.
 *  2. **Security → Change password** (PD-014) — Current · New · Confirm · Save,
 *     with the REAL password policy and strength meter. Nothing is wired: no
 *     Supabase Auth call, no password mutation, no migration.
 *
 * Admin access itself (roles, permissions) lives on Admin Staff, not here.
 */
export default async function PreviewSettingsPage() {
  const access = await requireAdminRoute("/admin/preview/settings");
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const st = m.admin.preview.settings;

  const { data: authData } = await supabase.auth.getUser();
  const roleLabels = m.admin.roleLabel as Record<string, string>;
  const roleNames = access.roles.map((r) => (r.isSystem ? (roleLabels[r.key] ?? r.name) : r.name));
  const authUser = authData.user;
  let displayName = "";
  let username = "";
  if (authUser) {
    const { data: profile } = await supabase.from("profiles").select("display_name, username").eq("user_id", authUser.id).maybeSingle();
    displayName = profile?.display_name ?? "";
    username = profile?.username ?? "";
  }

  return (
    <div className="flex flex-col gap-lg">
      <AdminHeader locale={locale} title={st.title} subtitle={st.subtitle} />

      <Card className="flex flex-col gap-md">
        <SectionTitle>{st.profileTitle}</SectionTitle>
        <div className="flex items-center gap-md">
          <Monogram name={displayName || "?"} size={56} />
          <div className="flex flex-col gap-1">
            <p className="text-label font-medium text-fg-secondary">{st.photo}</p>
            <PreviewActionDialog trigger={st.changePhoto} triggerVariant="outline" title={st.changePhoto} confirmLabel={st.changePhoto} confirmVariant="accent" />
          </div>
        </div>
        <div className="grid gap-md tablet:grid-cols-2">
          <LabeledField label={st.fullName} htmlFor="settings-name">
            <Input id="settings-name" defaultValue={displayName} />
          </LabeledField>
          <LabeledField label={st.username} htmlFor="settings-username" hint={st.usernameHint}>
            <Input id="settings-username" dir="ltr" defaultValue={username} placeholder={st.notProvided} />
          </LabeledField>
          <LabeledField label={st.phone} htmlFor="settings-phone">
            <Input id="settings-phone" dir="ltr" defaultValue={authUser?.phone ?? ""} placeholder={st.notProvided} />
          </LabeledField>
          <LabeledField label={st.email} htmlFor="settings-email">
            <Input id="settings-email" dir="ltr" defaultValue={authUser?.email ?? ""} disabled />
          </LabeledField>
          <Field label={st.role}>
            {roleNames.length ? (
              <span className="flex flex-wrap gap-1">
                {roleNames.map((n) => (
                  <Badge key={n} tone="accent">
                    {n}
                  </Badge>
                ))}
              </span>
            ) : (
              "—"
            )}
          </Field>
        </div>
        <p className="text-label text-fg-muted">{st.emailChangeNote}</p>
        <div className="flex justify-end">
          <PreviewActionDialog trigger={st.saveProfile} triggerVariant="accent" title={st.saveProfile} confirmLabel={st.saveProfile} confirmVariant="accent" />
        </div>
      </Card>

      <Card className="flex flex-col gap-md">
        <SectionTitle>{st.passwordTitle}</SectionTitle>
        <p className="text-body text-fg-secondary">{st.passwordBody}</p>
        <ChangePasswordPreview email={authUser?.email ?? ""} />
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
