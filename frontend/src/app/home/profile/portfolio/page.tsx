import { redirect } from "next/navigation";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { listMyPortfolio } from "@/server/queries/portfolio";
import { getServerSupabase } from "@/lib/supabase/server";
import { readableMediaSource } from "@/server/storage/edge-ticket";
import { NoProfessionalProfile } from "@/features/profile/no-professional-profile";
import { PortfolioManager, type PortfolioCard } from "@/features/portfolio/portfolio-manager";
import { VideoManager } from "@/features/video/video-manager";
import { listManagedVideos } from "@/server/queries/videos";
import { videoEnabled } from "@/server/video/playback";

export const dynamic = "force-dynamic";

/**
 * The Portfolio manager, under the Profile family (§2) rather than as a new
 * top-level destination. It is one facet of "what my profile says about me", and
 * a sidebar entry per facet is how a four-item navigation becomes a twelve-item
 * one without anybody deciding it should.
 *
 * PREVIEW URLS ARE MINTED HERE, at render, one per item and in parallel. They are
 * short-lived by construction and never stored — §6's "do not persist signed
 * URLs" applies to the owner's own previews too, and the cheapest way to honour
 * it is to have nowhere to persist them.
 *
 * A CONSUMER HAS NO PROFESSIONAL PROFILE and is told so rather than redirected,
 * the same answer the hub gives: nothing is wrong with the account, the page
 * simply belongs to a different kind of one.
 */
export default async function PortfolioPage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (!hasAppAccess(state)) redirect("/onboarding");

  const data = await loadPersonalHome();
  if (!data) redirect("/auth/sign-in");
  if (data.variant !== "professional") return <NoProfessionalProfile />;

  // Work inside a portfolio project is managed with its project (/home/profile/edit#portfolio).
  const [all, supabase] = await Promise.all([listMyPortfolio(), getServerSupabase()]);
  const items = all.filter((item) => !item.projectId);
  const cards: PortfolioCard[] = await Promise.all(
    items.map(async (item) => {
      // A pending item has no bytes yet, so there is nothing to sign and asking
      // would cost a round trip to be told NoSuchKey.
      if (item.pending) return { ...item, previewUrl: null };
      // Same caller-scoped resolve as createAssetReadUrl, plus edge variant URLs.
      const source = await readableMediaSource(supabase, "portfolio", item.objectKey).catch(() => null);
      return { ...item, previewUrl: source?.src ?? null, previewVariants: source?.variants ?? null };
    }),
  );

  // Video appears only while uploads go to R2 and playback runs at the edge.
  const videos = videoEnabled() ? (await listManagedVideos({ scope: "portfolio" })).filter((v) => !v.projectId) : null;
  return (
    <>
      <PortfolioManager items={cards} videos={videos ?? []} />
      {videos && <div className="mt-xl"><VideoManager scope="portfolio" videos={videos} canPublish showList={false} /></div>}
    </>
  );
}
