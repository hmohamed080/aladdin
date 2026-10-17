import Link from "next/link";
import { cookies } from "next/headers";
import { getMessages, createTranslator } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { resolveBilingualText } from "@/lib/i18n/bilingual";
import { resolveTimezone } from "@/lib/workspace/timezone";
import { THEME_COOKIE } from "@/lib/theme/config";
import { allowedNavKeys } from "@/lib/nav/modules";
import { Card, SectionTitle, Field, Badge } from "@/components/ui/primitives";
import { LanguageSwitch, ThemeSwitch } from "@/components/layout/switchers";
import { formatCount } from "@/lib/ui/format";
import { maskEmail } from "@/lib/ui/mask-email";
import { isCraftsmanLoginAlias, userFacingEmail } from "@/lib/auth/craftsman-login-alias";
import { OrganizationIdentityDialog } from "@/features/organization/organization-identity-dialog";
import { BranchGovernance } from "@/features/organization/branch-governance";
import { IdentityChangePanel } from "@/features/organization/identity-change-panel";
import { ActivitySelector } from "@/features/profile/activity-selector";
import { IdentityCard } from "@/features/settings/identity-card";
import { loadIdentityState, loadManagedBranches } from "@/server/queries/organization-governance";
import { loadOrganizationActivities, loadOrganizationActivityCatalog } from "@/server/queries/activities";
import { loadMyIdentity } from "@/server/queries/profile-identity";
import { loadOrganizationImageUrl } from "@/server/queries/organization-image";
import { OrganizationImageField } from "@/features/organization/organization-image-field";
import { OrganizationDescriptionField } from "@/features/organization/organization-description-field";
import { setOrganizationActivitiesAction } from "@/server/actions/activities";
import { BadgeCheckIcon, BuildingIcon, LayersIcon, MapPinIcon, SettingsIcon, ShieldIcon, TagIcon, UsersIcon, UserIcon, HelpIcon } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";
import type { requireShowroomContext } from "../context";

type Ctx = Awaited<ReturnType<typeof requireShowroomContext>>;

export const SETTINGS_SECTIONS = ["business", "activities", "branches", "access", "account", "appearance", "support"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

const ICONS: Record<SettingsSection, React.ComponentType<{ size?: number }>> = {
  business: BuildingIcon, activities: TagIcon, branches: MapPinIcon, access: UsersIcon, account: UserIcon, appearance: SettingsIcon, support: HelpIcon,
};

/** Unknown or unavailable sections fall back to the first one the caller may open. */
export function resolveSettingsSection(raw: string | undefined, available: readonly SettingsSection[]): SettingsSection {
  return available.find((s) => s === raw) ?? available[0]!;
}

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";
const buttonLink = "inline-flex min-h-9 w-fit items-center gap-2 rounded-sm border border-strong px-md py-1.5 text-label font-medium text-fg hover:bg-surface-2";

/**
 * Showroom Settings (V2). The page is a frame around the EXISTING governance and account machinery - the same
 * RPC-backed dialogs, panels and actions the business workspace has always used - grouped into sections so no
 * single screen is one long scroll. Nothing here writes protected data directly: the legal name changes only
 * through the Admin-reviewed request panel, the organization type is read-only, branches follow the
 * internal/public verification flow, roles are managed on the Team page, and the personal profile has one
 * source of truth (the shared identity card).
 */
export async function ShowroomSettings({ ctx, locale, section: rawSection }: { ctx: Ctx; locale: Locale; section?: string }) {
  const { org } = ctx;
  const m = getMessages(locale);
  const t = createTranslator(locale);
  const caps = org.capabilities;
  const canManageOrg = caps.includes("org.manage");
  const canManagePeople = caps.includes("org.members.manage");
  const canManageBranches = canManageOrg || caps.includes("branch.manage");

  const available = SETTINGS_SECTIONS.filter((s) => (s === "activities" ? canManageOrg : true));
  const section = resolveSettingsSection(rawSection, available);

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0" data-testid="showroom-settings">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-headline text-fg">{t("showroomSettings.title")}</h1>
        <p className="text-body text-fg-secondary">{t("showroomSettings.subtitle")}</p>
      </div>

      <div className="grid min-w-0 gap-lg desktop:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label={t("showroomSettings.navLabel")} className="min-w-0">
          <ul className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] desktop:mx-0 desktop:flex-col desktop:overflow-visible desktop:px-0 desktop:pb-0 [&::-webkit-scrollbar]:hidden">
            {available.map((key) => {
              const Icon = ICONS[key];
              const active = key === section;
              return (
                <li key={key} className="shrink-0 desktop:shrink">
                  <Link
                    href={`${SHOWROOM_ROOT}/settings?section=${key}`}
                    aria-current={active ? "page" : undefined}
                    data-testid={`settings-nav-${key}`}
                    className={cn(
                      "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-label font-medium transition-colors",
                      active ? "bg-accent-solid/15 text-accent" : "bg-surface text-fg-secondary hover:bg-surface-2/60 hover:text-fg",
                      focusRing,
                    )}
                  >
                    <Icon size={16} />
                    {t(`showroomSettings.section.${key}`)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-lg [&>*]:min-w-0" data-testid={`settings-section-${section}`}>
          {section === "business" ? <BusinessSection ctx={ctx} locale={locale} canManageOrg={canManageOrg} /> : null}
          {section === "activities" ? <ActivitiesSection ctx={ctx} locale={locale} /> : null}
          {section === "branches" ? <BranchesSection ctx={ctx} locale={locale} canManageBranches={canManageBranches} /> : null}
          {section === "access" ? <AccessSection ctx={ctx} locale={locale} canManagePeople={canManagePeople} /> : null}
          {section === "account" ? <AccountSection ctx={ctx} locale={locale} /> : null}
          {section === "appearance" ? <AppearanceSection locale={locale} /> : null}
          {section === "support" ? (
            <Card>
              <SectionTitle icon={<HelpIcon size={18} />}>{m.settings.support}</SectionTitle>
              <div className="mt-md flex flex-wrap items-center justify-between gap-md">
                <p className="min-w-0 flex-1 basis-72 text-body text-fg-secondary">{m.settings.supportBody}</p>
                <Link href="/auth/support" className={buttonLink}>{m.settings.supportLink}</Link>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

async function BusinessSection({ ctx, locale, canManageOrg }: { ctx: Ctx; locale: Locale; canManageOrg: boolean }) {
  const { supabase, org } = ctx;
  const m = getMessages(locale);
  const t = createTranslator(locale);
  const [{ data: record }, identityState, imageUrl] = await Promise.all([
    supabase
      .from("organizations")
      .select("name, org_type, status, business_verified_at, name_ar, name_en, timezone, description")
      .eq("id", org.organizationId)
      .maybeSingle(),
    // A verified organization's name changes only through a review request (never a direct edit).
    canManageOrg ? loadIdentityState(org.organizationId) : Promise.resolve(null),
    loadOrganizationImageUrl(supabase, org.organizationId),
  ]);
  // The badge is business verification, not approval of the application (status above).
  const verified = record?.business_verified_at != null;
  const pending = record?.status === "pending_verification";
  return (
    <>
      <Card>
        <SectionTitle
          icon={<BuildingIcon size={18} />}
          action={canManageOrg && !(identityState?.locked ?? false) ? (
            <OrganizationIdentityDialog m={m} orgId={org.organizationId} nameAr={record?.name_ar ?? null} nameEn={record?.name_en ?? null} timezone={record?.timezone ?? null} locked={identityState?.locked ?? false} />
          ) : undefined}
        >
          {m.settings.business}
        </SectionTitle>
        <div className="mt-md"><OrganizationImageField orgId={org.organizationId} imageUrl={imageUrl} canManage={canManageOrg} /></div>
        <div className="mt-md"><OrganizationDescriptionField orgId={org.organizationId} description={record?.description ?? null} canManage={canManageOrg} /></div>
        <dl className="mt-md grid gap-md tablet:grid-cols-2">
          <Field label={m.settings.field.name}>{resolveBilingualText(locale, record?.name ?? org.organizationName, record?.name_ar ?? null, record?.name_en ?? null)}</Field>
          <Field label={m.settings.field.type}>{record?.org_type ? m.directory.orgType[record.org_type] : "—"}</Field>
          <Field label={m.settings.field.status}>{record?.status ? m.settings.orgStatus[record.status] : "—"}</Field>
        </dl>
        {canManageOrg && identityState ? <IdentityChangePanel orgId={org.organizationId} view={identityState} /> : null}
        <p className="mt-md border-t pt-sm text-label text-fg-muted">{canManageOrg ? m.settings.businessNote : t("showroomSettings.readOnlyNote")}</p>
      </Card>

      <Card>
        <SectionTitle icon={<BadgeCheckIcon size={18} />}>{m.settings.verification}</SectionTitle>
        <div className="mt-md flex flex-col gap-sm">
          <div>
            {verified ? (
              <Badge tone="success"><BadgeCheckIcon size={13} />{m.directory.verified}</Badge>
            ) : (
              <Badge tone={pending ? "warning" : "neutral"}>{pending ? m.settings.orgStatus.pending_verification : m.directory.unverified}</Badge>
            )}
          </div>
          <p className="text-body text-fg-secondary">{verified ? m.settings.verifiedBody : m.settings.unverifiedBody}</p>
          {pending ? <p className="text-label text-fg-muted">{m.settings.verificationPending}</p> : null}
          {canManageOrg ? (
            <Link href={`${SHOWROOM_ROOT}/verification`} className={buttonLink} data-testid="settings-business-verification-link">
              <BadgeCheckIcon size={16} />{t("businessVerification.owner.title")}
            </Link>
          ) : null}
        </div>
      </Card>
    </>
  );
}

async function ActivitiesSection({ ctx, locale }: { ctx: Ctx; locale: Locale }) {
  const { supabase, org } = ctx;
  const { data: record } = await supabase.from("organizations").select("org_type").eq("id", org.organizationId).maybeSingle();
  const [catalog, selected] = await Promise.all([
    record?.org_type ? loadOrganizationActivityCatalog(record.org_type) : Promise.resolve([] as string[]),
    loadOrganizationActivities(org.organizationId),
  ]);
  const t = createTranslator(locale);
  return (
    <>
      {catalog.length > 0 ? <ActivitySelector catalog={catalog} selected={selected} action={setOrganizationActivitiesAction} orgId={org.organizationId} /> : null}
      <p className="text-label text-fg-muted">{t("showroomSettings.activitiesNote")}</p>
    </>
  );
}

async function BranchesSection({ ctx, locale, canManageBranches }: { ctx: Ctx; locale: Locale; canManageBranches: boolean }) {
  const { supabase, org } = ctx;
  const m = getMessages(locale);
  const t = createTranslator(locale);
  const [{ data: record }, { data: branchRows }, managed] = await Promise.all([
    supabase.from("organizations").select("status, timezone").eq("id", org.organizationId).maybeSingle(),
    org.branches.length > 0
      ? supabase.from("branches").select("id, name, name_ar, name_en, address_ar, address_en, timezone").in("id", org.branches.map((b) => b.id))
      : Promise.resolve({ data: [] as never[] }),
    canManageBranches ? loadManagedBranches(org.organizationId) : Promise.resolve([]),
  ]);
  const details = new Map((branchRows ?? []).map((b) => [b.id, b]));
  return (
    <Card>
      <SectionTitle icon={<MapPinIcon size={18} />}>
        {m.settings.branches}
        <span className="ms-2 text-label font-normal text-fg-muted">
          {org.branches.length === 1 ? m.settings.branchCountOne : m.settings.branchCount.replace("{count}", formatCount(org.branches.length, locale))}
        </span>
      </SectionTitle>
      <div className="mt-md">
        {canManageBranches ? (
          <BranchGovernance m={m} orgId={org.organizationId} rows={managed} orgIsApproved={record?.status === "active"} />
        ) : org.branches.length === 0 ? (
          <p className="text-body text-fg-muted">{m.settings.noBranches}</p>
        ) : (
          <ul className="grid gap-1.5 tablet:grid-cols-2">
            {org.branches.map((b) => {
              const detail = details.get(b.id);
              const name = resolveBilingualText(locale, b.name, detail?.name_ar ?? null, detail?.name_en ?? null);
              const tz = detail?.timezone ?? t("settings.timezoneInherited", { tz: resolveTimezone(null, record?.timezone) });
              return (
                <li key={b.id} className="flex flex-col gap-1 rounded-sm bg-surface-2/50 px-3 py-2 text-body text-fg-secondary">
                  <span className="flex min-w-0 items-center gap-2"><MapPinIcon size={15} /><span className="min-w-0 truncate">{name}</span></span>
                  <span className="ms-6 text-label text-fg-muted">{tz}</span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-md border-t pt-sm text-label text-fg-muted">{m.settings.branchNote}</p>
      </div>
    </Card>
  );
}

function AccessSection({ ctx, locale, canManagePeople }: { ctx: Ctx; locale: Locale; canManagePeople: boolean }) {
  const m = getMessages(locale);
  const t = createTranslator(locale);
  const reachable = allowedNavKeys(ctx.org.capabilities).filter((k) => k !== "home" && k !== "settings");
  return (
    <Card>
      <SectionTitle icon={<LayersIcon size={18} />}>{m.settings.access}</SectionTitle>
      <div className="mt-md flex flex-col gap-md">
        <div>
          <p className="text-body-lg text-fg">{m.settings.yourAccess}</p>
          {/* Module names, never raw capability keys: those are internal identifiers. */}
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {reachable.length === 0 ? <li className="text-body text-fg-muted">{m.settings.noCapabilities}</li> : reachable.map((k) => <li key={k}><Badge tone="neutral">{m.nav[k]}</Badge></li>)}
          </ul>
        </div>
        {canManagePeople ? <Link href="/b2b/organization" className={buttonLink}><UsersIcon size={16} />{t("showroomSettings.manageTeam")}</Link> : null}
        <p className="border-t pt-sm text-label text-fg-muted">{m.settings.accessNote}</p>
        <p className="text-label text-fg-muted" data-testid="members-privacy-note">{t("showroomSettings.privacy.membersBody")}</p>
      </div>
    </Card>
  );
}

async function AccountSection({ ctx, locale }: { ctx: Ctx; locale: Locale }) {
  const [identity, { data: auth }] = await Promise.all([loadMyIdentity(), ctx.supabase.auth.getUser()]);
  const m = getMessages(locale);
  // An installer phone account's internal login alias is never shown (lib/auth/craftsman-login-alias.ts).
  const visible = userFacingEmail(auth.user?.email);
  const signInEmail = visible ? maskEmail(visible) : null;
  const phonePassword = isCraftsmanLoginAlias(auth.user?.email);
  const t = createTranslator(locale);
  return (
    <>
      <div className="rounded-md border bg-surface-2/40 p-md" data-testid="account-privacy-note">
        <p className="text-body font-medium text-fg">{t("showroomSettings.privacy.accountTitle")}</p>
        <p className="mt-1 text-label text-fg-muted">{t("showroomSettings.privacy.accountBody")}</p>
      </div>
      {identity ? <IdentityCard identity={identity} /> : null}
      <Card>
        <SectionTitle icon={<ShieldIcon size={18} />}>{m.settings.signIn}</SectionTitle>
        <div className="mt-md flex flex-col gap-sm">
          {signInEmail ? <Field label={m.settings.signInContact}><span dir="ltr">{signInEmail}</span></Field> : null}
          {/* No password or 2FA rows: only the controls that exist are offered. */}
          <p className="text-body text-fg-secondary">{phonePassword ? m.settings.signInBodyPhonePassword : m.settings.signInBody}</p>
          {phonePassword ? null : <p className="text-label text-fg-muted">{m.settings.signInContactHint}</p>}
        </div>
      </Card>
    </>
  );
}

async function AppearanceSection({ locale }: { locale: Locale }) {
  const m = getMessages(locale);
  const t = createTranslator(locale);
  const theme = (await cookies()).get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";
  return (
    <Card>
      <SectionTitle icon={<SettingsIcon size={18} />}>{m.settings.preferences}</SectionTitle>
      <p className="mt-1 text-label text-fg-muted">{t("showroomSettings.appearanceBody")}</p>
      <div className="mt-md flex flex-col gap-md">
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <div className="min-w-0"><p className="text-body-lg text-fg">{m.nav.language}</p><p className="text-label text-fg-muted">{m.settings.languageHint}</p></div>
          <LanguageSwitch />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-sm border-t pt-md">
          <div className="min-w-0"><p className="text-body-lg text-fg">{m.nav.theme}</p><p className="text-label text-fg-muted">{m.settings.themeHint}</p></div>
          <ThemeSwitch current={theme} />
        </div>
      </div>
    </Card>
  );
}
