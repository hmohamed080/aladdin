import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { loadPublicProfile } from "@/server/queries/professional-profile";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { contentColumnClass } from "@/components/layout/content-column";
import { PublicProfileView } from "@/features/profile/public-profile";
import { cn } from "@/lib/ui/cn";

export const dynamic = "force-dynamic";

/**
 * A professional's PUBLIC profile — the destination the technicians directory has
 * been pointing at since it shipped without one (audit finding 2.5).
 *
 * DELIBERATELY OUTSIDE `/home`. It is not a personal surface: it is reachable
 * signed out (the middleware's authenticated set covers `/b2b`, `/admin`, `/home`
 * and `/onboarding`, not this), it carries no workspace chrome, and the visitor is
 * usually somebody else — a showroom deciding who to bring to a site.
 *
 * NOT FOUND COVERS THREE CASES ON PURPOSE: no such profile, a profile that is not
 * listed, and one whose account is no longer active. `profile_public_directory`
 * returns nothing for all three, and this page must not let a visitor tell them
 * apart — distinguishing them would confirm the existence of a private profile to
 * anyone who could guess an id.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ profileId: string }>;
}): Promise<Metadata> {
  const { profileId } = await params;
  const profile = await loadPublicProfile(profileId);
  // No title leak for a profile the visitor may not see — the generic product
  // title is what an unlisted id gets, exactly like a nonexistent one.
  if (!profile) return {};
  return {
    title: profile.displayName ? `${profile.displayName} · Aladdin` : "Aladdin",
    description: profile.headline ?? undefined,
  };
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { profileId } = await params;
  const profile = await loadPublicProfile(profileId);
  if (!profile) notFound();

  const store = await cookies();
  const t = createTranslator(resolveLocale(store.get(LOCALE_COOKIE)?.value));

  return (
    <main className={cn(contentColumnClass, "py-xl")} id="main">
      <PublicProfileView profile={profile} t={t} />
    </main>
  );
}
