import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import type { Locale } from "@/lib/i18n/locales";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { SETTINGS_SECTION_IDS, settingsSectionTitle, type SettingsSectionId } from "@/features/engineer/settings-sections";
import "@/features/engineer/settings.css";

/** Shared guard + frame for the Email and Phone settings sub-pages (same checks as `/home/settings`). */
export async function loadContactPageFrame(): Promise<{ locale: Locale; ar: boolean }> {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (!hasAppAccess(state)) redirect("/onboarding");
  const home = await loadPersonalHome();
  if (!home) redirect("/auth/sign-in");
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return { locale, ar: locale === "ar" };
}

/** A settings sub-page inside the same frame as the tabbed page: title and tabs stay, with a way back. */
export function ContactPageShell({
  ar,
  title,
  intro,
  from,
  children,
}: {
  ar: boolean;
  title: string;
  intro: string;
  from: SettingsSectionId;
  children: React.ReactNode;
}) {
  return (
    <div className="engineer-settings engineer-subpage">
      <div className="engineer-settings-layout">
        <div className="engineer-settings-side">
          <header className="engineer-settings-heading">
            <h1>{ar ? "الإعدادات" : "Settings"}</h1>
            <p>{ar ? "إدارة بياناتك الشخصية وحسابك." : "Manage your personal details and your account."}</p>
          </header>
          <nav className="engineer-settings-nav" aria-label={ar ? "أقسام الإعدادات" : "Settings sections"}>
            {SETTINGS_SECTION_IDS.map((id) => (
              <Link key={id} href={`/home/settings#settings-${id}`} aria-current={id === from ? "page" : undefined}>
                {settingsSectionTitle(id, ar)}
              </Link>
            ))}
          </nav>
        </div>
        <div className="engineer-settings-content">
          <section className="engineer-settings-panel">
            <Link href={`/home/settings#settings-${from}`} className="engineer-contact-back">
              <ChevronLeftIcon size={16} />
              {ar ? `الرجوع إلى ${settingsSectionTitle(from, true)}` : `Back to ${settingsSectionTitle(from, false)}`}
            </Link>
            <header>
              <div>
                <h2>{title}</h2>
                <p>{intro}</p>
              </div>
            </header>
            {children}
          </section>
        </div>
      </div>
    </div>
  );
}
