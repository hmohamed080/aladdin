import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { readStaffInvitationToken } from "@/server/auth/staff-invitation-token";
import { lookupStaffInvitation } from "@/server/queries/staff-invitations";
import { StaffRegisterForm } from "@/features/staff-invitation/staff-register-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Registration for an invited staff member. Only reachable with a live invitation, and only while signed out. */
export default async function StaffInvitationRegisterPage() {
  const [view, user] = await Promise.all([lookupStaffInvitation(await readStaffInvitationToken()), getCurrentUser()]);
  if (user || view.status !== "pending") redirect("/auth/staff-invitation");
  return <StaffRegisterForm />;
}
