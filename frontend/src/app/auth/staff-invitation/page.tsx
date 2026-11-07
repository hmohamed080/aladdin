import type { Metadata } from "next";
import { getCurrentUser } from "@/server/auth/session";
import { readStaffInvitationToken } from "@/server/auth/staff-invitation-token";
import { lookupStaffInvitation } from "@/server/queries/staff-invitations";
import { StaffInvitationEntry } from "@/features/staff-invitation/staff-invitation-entry";

export const dynamic = "force-dynamic";
// An invitation page is never indexed and never leaks a Referer.
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** The tokenless landing of an Admin Staff invitation. The token comes from the httpOnly handoff cookie, never from the URL. */
export default async function StaffInvitationPage() {
  const [view, user] = await Promise.all([lookupStaffInvitation(await readStaffInvitationToken()), getCurrentUser()]);
  return <StaffInvitationEntry view={view} isSignedIn={Boolean(user)} />;
}
