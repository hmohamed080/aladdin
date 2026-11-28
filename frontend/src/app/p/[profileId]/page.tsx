import { redirect } from "next/navigation";
import { PublicProfileContent, publicProfileMetadata } from "@/features/profile/public-profile-page";
import { publicProfileHref, publicRouteById } from "@/server/queries/public-profile-routes";

export const dynamic = "force-dynamic";
export const generateMetadata = publicProfileMetadata;

/** The id link every directory already uses. A profile with a readable URL is sent there; the others render here. */
export default async function PublicProfilePage(props: { params: Promise<{ profileId: string }> }) {
  const { profileId } = await props.params;
  const route = await publicRouteById(profileId);
  if (route) redirect(publicProfileHref(route));
  return PublicProfileContent(props);
}
