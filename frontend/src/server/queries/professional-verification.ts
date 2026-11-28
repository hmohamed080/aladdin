import { cache } from "react";
import { getServerSupabase } from "@/lib/supabase/server";

/** The caller's own professional verification, as the applicant may see it (the reason is shared with them). */
export type MyProfessionalVerification = {
  status: "draft" | "submitted" | "under_review" | "needs_more_info" | "approved" | "rejected";
  reason: string | null;
};

const STATUSES: readonly string[] = ["draft", "submitted", "under_review", "needs_more_info", "approved", "rejected"];

/**
 * The newest professional verification request of the signed-in user, or null when none was filed. Filtered to the
 * caller explicitly: the table's read policy also lets an Admin read other users' rows, and this must never show them.
 */
export const loadMyProfessionalVerification = cache(async function loadMyProfessionalVerification(): Promise<MyProfessionalVerification | null> {
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from("verifications")
    .select("status, reason")
    .eq("subject_type", "user")
    .eq("user_id", uid)
    .eq("verification_type", "professional")
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data || !STATUSES.includes(data.status)) return null;
  return { status: data.status as MyProfessionalVerification["status"], reason: data.reason ?? null };
});
