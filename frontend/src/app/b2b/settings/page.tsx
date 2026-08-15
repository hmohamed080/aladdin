import Link from "next/link";
import { cookies } from "next/headers";
import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { THEME_COOKIE } from "@/lib/theme/config";
import { allowedNavKeys } from "@/lib/nav/modules";
import { PageHeader } from "@/features/sales/page-parts";
import { Card, SectionTitle, Field, Badge } from "@/components/ui/primitives";
import { LanguageSwitch, ThemeSwitch } from "@/components/layout/switchers";
import { BuildingIcon, SettingsIcon, UsersIcon, MapPinIcon, ShieldIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Settings — the business record, workspace preferences, and where to change the
 * things that live elsewhere.
 *
 * Read-mostly by design. Every field shown here is either already editable through
 * an existing trusted path (people and capabilities on the Team page) or is
 * server-controlled and must not become a client-side form (verification state,
 * organization type, branch structure). Adding editors for those would mean
 * inventing write paths this sprint has no requirement for.
 */
export default async function SettingsPage() {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const store = await cookies();
  const theme = store.get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";

  const { data: record } = await supabase
    .from("organizations")
    .select("name, slug, org_type, status, is_verified, primary_locale")
    .eq("id", org.organizationId)
    .maybeSingle();

  const canManagePeople = org.capabilities.includes("org.members.manage");
  const reachable = allowedNavKeys(org.capabilities).filter((k) => k !== "home" && k !== "settings");

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader title={m.settings.title} subtitle={m.settings.subtitle} />

      <div className="grid gap-lg desktop:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <SectionTitle icon={<BuildingIcon size={18} />}>{m.settings.business}</SectionTitle>
          <dl className="mt-md grid gap-md tablet:grid-cols-2">
            <Field label={m.settings.field.name}>{record?.name ?? org.organizationName}</Field>
            <Field label={m.settings.field.type}>
              {record?.org_type ? m.directory.orgType[record.org_type] : "—"}
            </Field>
            <Field label={m.settings.field.status}>
              {record?.status ? m.settings.orgStatus[record.status] : "—"}
            </Field>
            <Field label={m.settings.field.verification}>
              {record?.is_verified ? (
                <Badge tone="success">{m.directory.verified}</Badge>
              ) : (
                <Badge tone="neutral">{m.directory.unverified}</Badge>
              )}
            </Field>
          </dl>
          <p className="mt-md border-t pt-sm text-label text-fg-muted">{m.settings.businessNote}</p>
        </Card>

        <Card>
          <SectionTitle icon={<SettingsIcon size={18} />}>{m.settings.preferences}</SectionTitle>
          <div className="mt-md flex flex-col gap-md">
            <div className="flex flex-wrap items-center justify-between gap-sm">
              <div className="min-w-0">
                <p className="text-body-lg text-fg">{m.nav.language}</p>
                <p className="text-label text-fg-muted">{m.settings.languageHint}</p>
              </div>
              <LanguageSwitch />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-sm border-t pt-md">
              <div className="min-w-0">
                <p className="text-body-lg text-fg">{m.nav.theme}</p>
                <p className="text-label text-fg-muted">{m.settings.themeHint}</p>
              </div>
              <ThemeSwitch current={theme} />
            </div>
          </div>
        </Card>

        <Card>
          <SectionTitle icon={<MapPinIcon size={18} />}>{m.settings.branches}</SectionTitle>
          <div className="mt-md">
            {org.branches.length === 0 ? (
              <p className="text-body text-fg-muted">{m.settings.noBranches}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {org.branches.map((b) => (
                  <li key={b.id} className="flex items-center gap-2 text-body text-fg-secondary">
                    <span className="text-fg-muted" aria-hidden="true">
                      <MapPinIcon size={15} />
                    </span>
                    {b.name}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-md border-t pt-sm text-label text-fg-muted">{m.settings.branchNote}</p>
          </div>
        </Card>

        <Card>
          <SectionTitle icon={<ShieldIcon size={18} />}>{m.settings.access}</SectionTitle>
          <div className="mt-md flex flex-col gap-md">
            <div>
              <p className="text-body-lg text-fg">{m.settings.yourAccess}</p>
              {/* Deliberately NOT the raw capability keys: `org.members.manage` is
                  an internal identifier that would render untranslated in Arabic
                  and means nothing to the person reading it. The modules those
                  capabilities unlock are the same information, in their language. */}
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {reachable.length === 0 ? (
                  <li className="text-body text-fg-muted">{m.settings.noCapabilities}</li>
                ) : (
                  reachable.map((k) => (
                    <li key={k}>
                      <Badge tone="neutral">{m.nav[k]}</Badge>
                    </li>
                  ))
                )}
              </ul>
            </div>
            {canManagePeople ? (
              <Link
                href="/b2b/organization"
                className="inline-flex min-h-9 w-fit items-center gap-2 rounded-sm border border-strong px-md py-1.5 text-label font-medium text-fg hover:bg-surface-2"
              >
                <UsersIcon size={16} />
                {m.settings.manageTeam}
              </Link>
            ) : null}
            <p className="border-t pt-sm text-label text-fg-muted">{m.settings.accessNote}</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
