import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { listMyReviewsPage, loadMyReviewMonthly, loadMyReviewSummary } from "@/server/queries/reviews";
import { InstallerReviews } from "@/features/installer-reviews/installer-reviews";
import { loadInstallerReviewsAction } from "@/server/actions/review-list";
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
  if (!hasAppAccess(state)) redirect("/onboarding");

  const data = await loadPersonalHome();
  if (!data) redirect("/auth/sign-in");
  if (data.variant !== "professional") return <NoProfessionalProfile />;

  // An Installer gets the approved Reviews design (`/preview/installer-reviews`) on real, keyset-paged data.
  if (data.accountType === "installer_technician") {
    const [first, summary, monthly] = await Promise.all([listMyReviewsPage(), loadMyReviewSummary(), loadMyReviewMonthly(6)]);
    return (
      <InstallerReviews
        summary={summary}
        monthly={monthly}
        initial={{ reviews: first.reviews, nextCursor: first.nextCursor }}
        load={loadInstallerReviewsAction}
      />
    );
  }

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);

  const { rating } = await searchParams;
  const parsed = Number(rating);
  const filter = Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : null;

  // The summary is the database's EXACT counts over the whole set (never derived from the rows on screen);
  // the list is the FIRST keyset page, filtered in SQL, with the cursor of the next ("Show more").
  const [page, summary] = await Promise.all([listMyReviewsPage({ rating: filter }), loadMyReviewSummary()]);

  return (
    <ReviewsPage
      reviews={page.reviews}
      nextCursor={page.nextCursor}
      summary={summary}
      filter={filter}
      t={t}
      locale={locale}
    />
  );
}
