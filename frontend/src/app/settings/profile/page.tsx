import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { activeLandingPath } from "@/server/queries/landing";
import { loadMyIdentity, loadMyProfileCompletion } from "@/server/queries/profile-identity";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { IdentityCard } from "@/features/settings/identity-card";
import { CompleteProfileCard } from "@/features/profile/complete-profile-card";

export const dynamic = "force-dynamic";

/**
 * `/settings/profile` — the person's OWN identity (display name, photo, phone),
 * reachable by ANY caller with application access (`access_ready` or
 * `active_personal`), with no workspace requirement at all: no personal
 * persona, no organization membership, no `/b2b` access. That is what lets a
 * Showroom/Supplier/Manufacturer/Importer-intent account with zero
 * organizations complete the user-level items of its checklist.
 *
 * Reuses the SAME `IdentityCard` (and its three single-purpose RPCs) that
 * `/home/settings` and `/b2b/settings` render — no second implementation.
 * Organization activities/subtypes are deliberately NOT here: they belong to
 * an organization and stay on `/b2b/settings` behind org.manage.
 */
export default async function ProfileSettingsPage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (!hasAppAccess(state)) redirect("/onboarding");

  const [identity, completion, back] = await Promise.all([
    loadMyIdentity(),
    loadMyProfileCompletion(),
    activeLandingPath(),
  ]);
  if (!identity) redirect("/auth/sign-in");

  const store = await cookies();
  const t = createTranslator(resolveLocale(store.get(LOCALE_COOKIE)?.value));

  return (
    <div className="flex flex-col gap-lg" data-testid="profile-settings">
      <div className="flex flex-col gap-1">
        <Link href={back} className="text-label font-medium text-accent hover:underline" data-testid="profile-settings-back">
          {t("profileIdentity.page.back")}
        </Link>
        <h1 className="text-headline text-fg">{t("profileIdentity.page.title")}</h1>
        <p className="text-body text-fg-secondary">{t("profileIdentity.page.subtitle")}</p>
      </div>
      {completion ? <CompleteProfileCard completion={completion} /> : null}
      <IdentityCard identity={identity} />
    </div>
  );
}
