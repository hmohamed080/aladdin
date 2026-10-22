import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaces } from "@/server/queries/workspace";
import { personalEntry } from "@/lib/workspace/model";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { THEME_COOKIE } from "@/lib/theme/config";
import { maskEmail } from "@/lib/ui/mask-email";
import { isCraftsmanLoginAlias, userFacingEmail } from "@/lib/auth/craftsman-login-alias";
import { PersonalSettings } from "@/features/settings/personal-settings";
import { EngineerSettings } from "@/features/engineer/settings";
import { isEngineer } from "@/features/engineer/links";
import { loadMyIdentity, loadMyProfileCompletion } from "@/server/queries/profile-identity";
import { loadMyAvailabilityWindows } from "@/server/queries/service-areas";
import { oauthAvailability } from "@/server/auth/entry-oauth";
import { loadMyDevices, loadMySessions } from "@/server/queries/account-devices";
import { PASSWORD_SET_FLAG } from "@/lib/supabase/admin-server";

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
  const [{ data: auth }, identity, completion, availabilityWindows, identities, oauth, sessions, devices] = await Promise.all([
    supabase.auth.getUser(),
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
  const visibleEmail = userFacingEmail(auth?.user?.email);
  const signInEmail = visibleEmail ? maskEmail(visibleEmail) : null;

  const common = {
    locale,
    home,
    signInEmail,
    signInMethod: isCraftsmanLoginAlias(auth?.user?.email) ? ("phone_password" as const) : ("email_code" as const),
    theme: theme as "light" | "dark",
    t,
    identity,
    completion,
  };
  if (engineer && oauth) {
    return (
      <EngineerSettings
        {...common}
        linkedProviders={(identities?.data?.identities ?? []).map((i) => i.provider)}
        linkedDetails={Object.fromEntries(
          (identities?.data?.identities ?? []).flatMap((i) => {
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
        hasPassword={auth?.user?.app_metadata?.[PASSWORD_SET_FLAG] === true}
      />
    );
  }
  return <PersonalSettings {...common} availabilityWindows={availabilityWindows} />;
}
