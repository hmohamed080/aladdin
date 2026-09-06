import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState } from "@/server/queries/registration";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { listMyReviews, loadMyReviewSummary } from "@/server/queries/reviews";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { NoProfessionalProfile } from "@/features/profile/no-professional-profile";
import { ReviewsPage } from "@/features/reviews/reviews-page";

export const dynamic = "force-dynamic";

/**
 * `/home/reviews` — what clients said about finished work.
 *
 * THE SUMMARY IS ALWAYS OF THE WHOLE SET, and the list is what the filter
 * narrows. That asymmetry is deliberate: an average that moved when you clicked
 * "5 stars" would not be an average of anything a reader could name.
 *
 * A CONSUMER HAS NO REVIEWS TO SHOW and is told so rather than redirected, the
 * same answer the profile and portfolio pages give: nothing is wrong with the
 * account, the page belongs to a different kind of one.
 */
export default async function ReviewsRoute({
  searchParams,
}: {
  searchParams: Promise<{ rating?: string }>;
}) {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state !== "active_personal") redirect("/onboarding");

  const data = await loadPersonalHome();
  if (!data) redirect("/auth/sign-in");
  if (data.variant !== "professional") return <NoProfessionalProfile />;

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);

  // Both reads are cache()d and resolve to the same rows, so the summary below
  // is provably a summary OF the list rather than a second opinion about it.
  const [all, summary] = await Promise.all([listMyReviews(), loadMyReviewSummary()]);

  const { rating } = await searchParams;
  const parsed = Number(rating);
  const filter = Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : null;
  const shown = filter === null ? all : all.filter((r) => r.rating === filter);

  return (
    <ReviewsPage reviews={shown} summary={summary} filter={filter} t={t} locale={locale} />
  );
}
