import { redirect } from "next/navigation";
import { getRegistrationState } from "@/server/queries/registration";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { listMyCertificates } from "@/server/queries/portfolio";
import { NoProfessionalProfile } from "@/features/profile/no-professional-profile";
import { CertificatesManager } from "@/features/portfolio/certificates-manager";

export const dynamic = "force-dynamic";

/**
 * Certificates, beside Portfolio under the Profile family.
 *
 * NO SIGNED URL IS MINTED HERE, unlike the portfolio page. A certificate is
 * opened deliberately, one at a time, through `certificateViewUrlAction` — so no
 * URL for a private document is ever written into a page that a browser will
 * cache. The list itself carries only metadata the owner typed.
 */
export default async function CertificatesPage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state !== "active_personal") redirect("/onboarding");

  const data = await loadPersonalHome();
  if (!data) redirect("/auth/sign-in");
  if (data.variant !== "professional") return <NoProfessionalProfile />;

  return <CertificatesManager items={await listMyCertificates()} />;
}
