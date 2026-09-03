import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { loadPublicProfile } from "@/server/queries/professional-profile";
import { loadPublicPortfolio } from "@/server/queries/portfolio";
import { loadPublicReviews } from "@/server/queries/reviews";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { contentColumnClass } from "@/components/layout/content-column";
import { PublicProfileView } from "@/features/profile/public-profile";
import { PublicPortfolio } from "@/features/profile/public-portfolio";
import { PublicReviews } from "@/features/profile/public-reviews";
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
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);

  // Only ever the published items of a currently listed profile: the projection
  // itself carries that test, so this page adds no filter of its own and cannot
  // disagree with the media route about what is public.
  const [portfolio, reviews] = await Promise.all([
    loadPublicPortfolio(profileId),
    // Unsuppressed reviews of a currently listed professional. The projection
    // carries that test, so this page adds no filter and cannot disagree with
    // the professional's own view of what is public.
    loadPublicReviews(profileId),
  ]);

  return (
    <main className={cn(contentColumnClass, "flex flex-col gap-xl py-xl")} id="main">
      <PublicProfileView profile={profile} t={t} locale={locale} />
      {/* Rendered only when there is something published. An empty section would
          tell a visitor that work exists and is being withheld, which is exactly
          the distinction the whole surface refuses to draw. */}
      <PublicPortfolio items={portfolio} t={t} />
      {/* Reviews after the work, for the same reason the work comes after the
          identity: a visitor decides who this is, sees what they have done, and
          then reads what other organizations said about it. Rendered only when
          there is something to show. */}
      <PublicReviews reviews={reviews} t={t} locale={locale} />
    </main>
  );
}
