import Link from "next/link";
import { cookies } from "next/headers";
import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { THEME_COOKIE } from "@/lib/theme/config";
import { allowedNavKeys } from "@/lib/nav/modules";
import { PageHeader } from "@/features/sales/page-parts";
import { Card, SectionTitle, Field, Badge } from "@/components/ui/primitives";
import { LanguageSwitch, ThemeSwitch } from "@/components/layout/switchers";
import {
  BuildingIcon,
  SettingsIcon,
  UsersIcon,
  MapPinIcon,
  ShieldIcon,
  BadgeCheckIcon,
  LayersIcon,
} from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/** `name@example.com` → `n••••@example.com`. The caller knows their own address;
 *  masking keeps it off a screen that gets shown to a client or screenshared. */
function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return email;
  return `${user.slice(0, 1)}${"•".repeat(Math.max(user.length - 1, 1))}@${domain}`;
}

/**
 * Settings — the business record, the workspace's own behaviour, and the account
 * the caller signs in with.
 *
 * Organised into three groups that answer three different owners' questions:
 * BUSINESS is about the company (its record, its verification, its branches),
 * WORKSPACE is about this installation of the product (language, theme),
 * ACCOUNT is about the person sitting in front of it (how they sign in, what
 * they can open, where to get help).
 *
 * Read-mostly by design. Every field shown here is either already editable
 * through an existing trusted path (people and capabilities on the Team page,
 * contact details on the personal profile) or is server-controlled and must not
 * become a client-side form — verification state, organization type and branch
 * structure are decided by review and by owners, not by a text input.
 *
 * There is deliberately NO billing, notifications, integrations or data-export
 * section. None of those systems exist, and a settings page of disabled
 * placeholders tells a client the product is further along than it is.
 */
export default async function SettingsPage() {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const store = await cookies();
  const theme = store.get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";

  const [{ data: record }, { data: auth }] = await Promise.all([
    supabase
      .from("organizations")
      .select("name, slug, org_type, status, is_verified, primary_locale")
      .eq("id", org.organizationId)
      .maybeSingle(),
    supabase.auth.getUser(),
  ]);

  const canManagePeople = org.capabilities.includes("org.members.manage");
  const reachable = allowedNavKeys(org.capabilities).filter((k) => k !== "home" && k !== "settings");
  const verified = record?.is_verified ?? false;
  const pending = record?.status === "pending_verification";
  const signInEmail = auth?.user?.email ? maskEmail(auth.user.email) : null;

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader title={m.settings.title} subtitle={m.settings.subtitle} />

      {/* ---------------------------- Business ---------------------------- */}
      <SectionTitle icon={<BuildingIcon size={18} />}>{m.settings.group.business}</SectionTitle>

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
            <Field label={m.settings.field.handle}>{record?.slug ?? "—"}</Field>
            <Field label={m.settings.field.language}>
              {record?.primary_locale === "ar" ? m.common.languageName.ar : m.common.languageName.en}
            </Field>
          </dl>
          <p className="mt-md border-t pt-sm text-label text-fg-muted">{m.settings.businessNote}</p>
        </Card>

        <Card>
          <SectionTitle icon={<BadgeCheckIcon size={18} />}>{m.settings.verification}</SectionTitle>
          <div className="mt-md flex flex-col gap-sm">
            <div>
              {verified ? (
                <Badge tone="success">
                  <BadgeCheckIcon size={13} />
                  {m.directory.verified}
                </Badge>
              ) : (
                <Badge tone={pending ? "warning" : "neutral"}>
                  {pending ? m.settings.orgStatus.pending_verification : m.directory.unverified}
                </Badge>
              )}
            </div>
            {/* Verification is what puts a business in front of buyers, so the
                consequence is stated rather than left as a coloured pill. */}
            <p className="text-body text-fg-secondary">
              {verified ? m.settings.verifiedBody : m.settings.unverifiedBody}
            </p>
            {pending ? <p className="text-label text-fg-muted">{m.settings.verificationPending}</p> : null}
          </div>
        </Card>

        <Card className="desktop:col-span-2">
          <SectionTitle icon={<MapPinIcon size={18} />}>
            {m.settings.branches}
            <span className="ms-2 text-label font-normal text-fg-muted">
              {org.branches.length === 1
                ? m.settings.branchCountOne
                : m.settings.branchCount.replace("{count}", String(org.branches.length))}
            </span>
          </SectionTitle>
          <div className="mt-md">
            {org.branches.length === 0 ? (
              <p className="text-body text-fg-muted">{m.settings.noBranches}</p>
            ) : (
              <ul className="grid gap-1.5 tablet:grid-cols-2 desktop:grid-cols-3">
                {org.branches.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-center gap-2 rounded-sm bg-surface-2/50 px-3 py-2 text-body text-fg-secondary"
                  >
                    <span className="text-fg-muted" aria-hidden="true">
                      <MapPinIcon size={15} />
                    </span>
                    <span className="min-w-0 truncate">{b.name}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-md border-t pt-sm text-label text-fg-muted">{m.settings.branchNote}</p>
          </div>
        </Card>
      </div>

      {/* ---------------------------- Workspace --------------------------- */}
      <SectionTitle icon={<SettingsIcon size={18} />}>{m.settings.group.workspace}</SectionTitle>

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

      {/* -------------------------- Account & access ---------------------- */}
      <SectionTitle icon={<ShieldIcon size={18} />}>{m.settings.group.account}</SectionTitle>

      <div className="grid gap-lg desktop:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <SectionTitle icon={<ShieldIcon size={18} />}>{m.settings.signIn}</SectionTitle>
          <div className="mt-md flex flex-col gap-sm">
            {signInEmail ? (
              <Field label={m.settings.signInContact}>
                <span dir="ltr">{signInEmail}</span>
              </Field>
            ) : null}
            {/* No password row, no "change password", no 2FA toggle: Aladdin is
                passwordless, and offering controls for a credential that does not
                exist would be the clearest possible lie about the security model. */}
            <p className="text-body text-fg-secondary">{m.settings.signInBody}</p>
            <p className="text-label text-fg-muted">{m.settings.signInContactHint}</p>
          </div>
        </Card>

        <Card>
          <SectionTitle icon={<LayersIcon size={18} />}>{m.settings.access}</SectionTitle>
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

        <Card className="desktop:col-span-2">
          <SectionTitle icon={<UsersIcon size={18} />}>{m.settings.support}</SectionTitle>
          <div className="mt-md flex flex-wrap items-center justify-between gap-md">
            <p className="min-w-0 flex-1 basis-72 text-body text-fg-secondary">{m.settings.supportBody}</p>
            <Link
              href="/auth/support"
              className="inline-flex min-h-9 w-fit items-center gap-2 rounded-sm border border-strong px-md py-1.5 text-label font-medium text-fg hover:bg-surface-2"
            >
              {m.settings.supportLink}
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
