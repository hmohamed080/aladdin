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
import { getContactEmailAdminClient, PASSWORD_SET_FLAG } from "@/lib/supabase/admin-server";
import { loadContactEmailStatus } from "@/server/identity/contact-email";
import { loadMyIdentity, loadMyProfileCompletion } from "@/server/queries/profile-identity";
import { loadMyAvailabilityWindows } from "@/server/queries/service-areas";

export const dynamic = "force-dynamic";

/** `/home/settings` — route guards and data only; composition lives in `PersonalSettings`. */
export default async function PersonalSettingsPage() {
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

  const [authUser, identity, completion, availabilityWindows] = await Promise.all([
    getCurrentUser(),
    loadMyIdentity(),
    loadMyProfileCompletion(),
    // The caller's own availability dates (RLS: own rows only). Only a professional sees the control that uses them.
    home.variant === "professional" ? loadMyAvailabilityWindows() : Promise.resolve([]),
  ]);
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
          username: identity.username,
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

  return (
    <PersonalSettings
      home={home}
      signInEmail={signInEmail}
      signInMethod={isCraftsmanLoginAlias(authUser?.email) ? "phone_password" : "email_code"}
      theme={theme}
      t={t}
      identity={identity}
      completion={completion}
      availabilityWindows={availabilityWindows}
    />
  );
}
