import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/session";
import { loadWorkspaces } from "@/server/queries/workspace";
import { personalEntry } from "@/lib/workspace/model";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { THEME_COOKIE } from "@/lib/theme/config";
import { maskEmail } from "@/lib/ui/mask-email";
import { isCraftsmanLoginAlias, userFacingEmail } from "@/lib/auth/craftsman-login-alias";
import { PersonalSettings } from "@/features/settings/personal-settings";
import { InstallerSettings } from "@/features/installer-settings/installer-settings";
import { EngineerSettings } from "@/features/engineer/settings";
import { isEngineer } from "@/features/engineer/links";
import { getContactEmailAdminClient, PASSWORD_SET_FLAG } from "@/lib/supabase/admin-server";
import { loadContactEmailStatus } from "@/server/identity/contact-email";
import { loadMyIdentity, loadMyProfileCompletion } from "@/server/queries/profile-identity";
import { loadMyAvailabilityWindows } from "@/server/queries/service-areas";
import { oauthAvailability } from "@/server/auth/entry-oauth";
import { loadMyDevices, loadMySessions } from "@/server/queries/account-devices";

export const dynamic = "force-dynamic";

/** `/home/settings` — route guards and data only; composition lives in `PersonalSettings`. */
export default async function PersonalSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ link?: string; provider?: string }>;
}) {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (!hasAppAccess(state)) redirect("/onboarding");

  const supabase = await getServerSupabase();
  const { entries } = await loadWorkspaces(supabase);
  if (!personalEntry(entries)) redirect("/");

  const home = await loadPersonalHome();
  if (!home) redirect("/auth/sign-in");

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);
  const theme = store.get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";

  const engineer = isEngineer(home);
  const [authUser, identity, completion, availabilityWindows, identities, oauth, sessions, devices] = await Promise.all([
    getCurrentUser(),
    loadMyIdentity(),
    loadMyProfileCompletion(),
    // The caller's own availability dates (RLS: own rows only). Only a professional sees the control that uses them.
    home.variant === "professional" && !engineer ? loadMyAvailabilityWindows() : Promise.resolve([]),
    engineer ? supabase.auth.getUserIdentities() : Promise.resolve(null),
    engineer ? oauthAvailability() : Promise.resolve(null),
    engineer ? loadMySessions() : Promise.resolve([]),
    engineer ? loadMyDevices() : Promise.resolve([]),
  ]);
  const { link, provider } = await searchParams;
  const linkNotice = link === "connected" || link === "taken" || link === "failed" ? link : null;
  // An installer phone account's internal login alias is never shown (lib/auth/craftsman-login-alias.ts).
  const visibleEmail = userFacingEmail(authUser?.email);
  const signInEmail = visibleEmail ? maskEmail(visibleEmail) : null;

  // An Installer gets the approved Installer Settings design (the production shell around it is the /home layout's).
  // The client receives only the caller's own fields and a boolean for "signs in with phone + password" - never the alias.
  if (home.accountType === "installer_technician" && identity && authUser) {
    const phoneAccount = isCraftsmanLoginAlias(authUser.email);
    const contactEmail = await loadContactEmailStatus(getContactEmailAdminClient(), authUser.id);
    return (
      <InstallerSettings
        data={{
          displayName: identity.displayName,
          phoneE164: identity.phoneE164,
          phoneNational: identity.phoneNational,
          phoneVerified: identity.phoneVerified,
          phoneAccount,
          contactEmail,
          hasPassword: phoneAccount || authUser.app_metadata?.[PASSWORD_SET_FLAG] === true,
          secondaryPhone: identity.secondaryPhone,
        }}
      />
    );
  }

  const common = {
    locale,
    home,
    signInEmail,
    signInMethod: isCraftsmanLoginAlias(authUser?.email) ? ("phone_password" as const) : ("email_code" as const),
    theme: theme as "light" | "dark",
    t,
    identity,
    completion,
    availabilityWindows,
  };
  if (engineer && oauth) {
    const linked = identities?.data?.identities ?? [];
    return (
      <EngineerSettings
        {...common}
        linkedProviders={linked.map((i) => i.provider)}
        linkedDetails={Object.fromEntries(
          linked.flatMap((i) => {
            // Which provider account is linked: its (masked) email, else its name. Saved by Supabase in auth.identities.
            const data = (i.identity_data ?? {}) as { email?: unknown; name?: unknown };
            const label = typeof data.email === "string" && data.email ? maskEmail(data.email) : typeof data.name === "string" ? data.name : "";
            return label ? [[i.provider, label]] : [];
          }),
        )}
        oauth={oauth}
        linkNotice={linkNotice}
        linkProvider={provider ?? null}
        sessions={sessions}
        devices={devices}
        hasPassword={authUser?.app_metadata?.[PASSWORD_SET_FLAG] === true}
      />
    );
  }
  return <PersonalSettings {...common} />;
}
