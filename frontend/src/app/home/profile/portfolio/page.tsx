import { redirect } from "next/navigation";
import { getRegistrationState } from "@/server/queries/registration";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { listMyPortfolio } from "@/server/queries/portfolio";
import { createAssetReadUrl } from "@/server/actions/professional-assets";
import { NoProfessionalProfile } from "@/features/profile/no-professional-profile";
import { PortfolioManager, type PortfolioCard } from "@/features/portfolio/portfolio-manager";

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
  if (state !== "active_personal") redirect("/onboarding");

  const data = await loadPersonalHome();
  if (!data) redirect("/auth/sign-in");
  if (data.variant !== "professional") return <NoProfessionalProfile />;

  const items = await listMyPortfolio();
  const cards: PortfolioCard[] = await Promise.all(
    items.map(async (item) => {
      // A pending item has no bytes yet, so there is nothing to sign and asking
      // would cost a round trip to be told NoSuchKey.
      if (item.pending) return { ...item, previewUrl: null };
      const url = await createAssetReadUrl("portfolio", item.objectKey);
      return { ...item, previewUrl: url.ok ? url.url : null };
    }),
  );

  return <PortfolioManager items={cards} />;
}
