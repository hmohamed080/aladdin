import { lookupInvitation } from "@/server/queries/invitations";
import { getCurrentUser } from "@/server/auth/session";
import { InvitePanel } from "@/features/auth/invite-panel";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [view, user] = await Promise.all([lookupInvitation(token), getCurrentUser()]);
  return <InvitePanel view={view} token={token} isSignedIn={Boolean(user)} />;
}
