import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/provider";
import { THEME_COOKIE } from "@/lib/theme/config";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaceContext } from "@/server/queries/context";
import { loadMandatoryBusinessSetup } from "@/server/queries/business-setup";
import { MANDATORY_BUSINESS_SETUP_PATH } from "@/lib/onboarding/mandatory-business-setup";
import { personalEntry } from "@/lib/workspace/model";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { NoOrgNotice } from "@/components/layout/no-org-notice";
import { orgBilingualNames } from "@/server/queries/organization-i18n";
import { resolveBilingualText } from "@/lib/i18n/bilingual";
import { ShowroomFrame } from "@/features/showroom-shell/frame";

export const dynamic = "force-dynamic";

/**
 * The authenticated B2B workspace shell. Middleware guarantees a session before
 * this renders. Organization/branch context is DERIVED from real memberships
 * (no role switcher, no persona switcher).
 *
 * A caller who cannot work in ANY business here — they never had a membership, or
 * the one they had was suspended/revoked — is resolved safely rather than shown a
 * broken workspace: to their Personal home when they have one, otherwise to a
 * clear notice. Direct navigation therefore cannot reach an organization the
 * caller no longer belongs to.
 */
export default async function B2BLayout({ children }: { children: ReactNode }) {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const dir = directionFor(locale);
  const theme = store.get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";

  const supabase = await getServerSupabase();
  const workspace = await loadWorkspaceContext(supabase);

  if (!workspace.active && personalEntry(workspace.entries)) redirect("/home");
  // No workspace and no Personal home. If this person registered to create a business that does not exist yet, creating it
  // is mandatory - send them to it rather than parking them on the "no workspace" notice.
  if (!workspace.active && (await loadMandatoryBusinessSetup()).required) redirect(MANDATORY_BUSINESS_SETUP_PATH);

  // A Showroom works inside the approved Showroom Suite V2 frame; the finished modules under /b2b keep their
  // routes, data and permissions and are simply rendered inside that one shell. Supplier, Manufacturer, Importer
  // and the other account types keep their current workspace until their own interfaces are approved.
  if (workspace.active && workspace.active.orgType === "showroom_dealer") {
    return <ShowroomFrame>{children}</ShowroomFrame>;
  }

  // The header's org/branch chips need the SAME Arabic/English preference the
  // rest of the workspace already applies (`resolveBilingualText`) — until
  // now only the Showroom dashboard's own greeting line read it, which is
  // exactly why the header fell back to the raw English `name` column in
  // Arabic. One narrow read here, scoped to the active org/branch only (never
  // every entry in the workspace switcher's dropdown — see
  // `orgBilingualNames`'s own doc comment on why this stays a targeted read).
  let orgDisplayName: string | undefined;
  let branchDisplayName: string | undefined;
  if (workspace.active) {
    const active = workspace.active;
    const names = await orgBilingualNames(supabase, active.organizationId, active.activeBranchId);
    orgDisplayName = resolveBilingualText(locale, active.organizationName, names.orgNameAr, names.orgNameEn);
    const activeBranch =
      active.branches.find((b) => b.id === active.activeBranchId) ??
      (active.branches.length === 1 ? active.branches[0] : undefined);
    if (activeBranch) {
      branchDisplayName = resolveBilingualText(locale, activeBranch.name, names.branchNameAr, names.branchNameEn);
    }
  }

  return (
    <I18nProvider locale={locale} dir={dir}>
      {workspace.active ? (
        <WorkspaceShell workspace={workspace} orgDisplayName={orgDisplayName} branchDisplayName={branchDisplayName}>
          {children}
        </WorkspaceShell>
      ) : (
        <NoOrgNotice theme={theme} />
      )}
    </I18nProvider>
  );
}
