import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState } from "@/server/queries/registration";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaces } from "@/server/queries/workspace";
import { personalEntry } from "@/lib/workspace/model";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { THEME_COOKIE } from "@/lib/theme/config";
import { maskEmail } from "@/lib/ui/mask-email";
import { PersonalSettings } from "@/features/settings/personal-settings";

export const dynamic = "force-dynamic";

/** `/home/settings` — route guards and data only; composition lives in `PersonalSettings`. */
export default async function PersonalSettingsPage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state !== "active_personal") redirect("/onboarding");

  const supabase = await getServerSupabase();
  const { entries } = await loadWorkspaces(supabase);
  if (!personalEntry(entries)) redirect("/");

  const home = await loadPersonalHome();
  if (!home) redirect("/auth/sign-in");

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);
  const theme = store.get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";

  const { data: auth } = await supabase.auth.getUser();
  const signInEmail = auth?.user?.email ? maskEmail(auth.user.email) : null;

  return <PersonalSettings home={home} signInEmail={signInEmail} theme={theme} t={t} />;
}
