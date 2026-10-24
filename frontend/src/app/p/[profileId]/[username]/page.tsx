import { notFound, redirect } from "next/navigation";
import { PublicProfileContent, publicProfileMetadata } from "@/features/profile/public-profile-page";
import { publicProfileHref, resolvePublicRoute } from "@/server/queries/public-profile-routes";
export const dynamic = "force-dynamic";
type Props = {params: Promise<{profileId: string; username: string}>};
// The parent segment retains its existing folder name for legacy UUID links;
// on this two-segment route it represents the public account type.
export async function generateMetadata({params}: Props) {
  const {profileId: persona, username} = await params;
  const route = await resolvePublicRoute(persona, username);
  if (!route) return {};
  return publicProfileMetadata({params: Promise.resolve({profileId: route.id})});
}
export default async function NamedPublicProfile({params}: Props) {
  const {profileId: persona, username} = await params;
  const route = await resolvePublicRoute(persona, username);
  if (!route) notFound();
  if (username !== route.username) redirect(publicProfileHref(route));
  return PublicProfileContent({params: Promise.resolve({profileId: route.id})});
}
