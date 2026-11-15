import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { Database } from "@/types/database.types";
import {
  parseDashboard,
  parsePoints,
  parsePortfolio,
  parseProfile,
  parseReviews,
  parseWork,
  type DashboardData,
  type PointsData,
  type PortfolioData,
  type ProfileData,
  type ReviewsData,
  type WorkData,
} from "@/lib/admin/view-as/craftsman-data";

/**
 * The view-as reader seam (docs/admin/ADMIN_VIEW_AS_ARCHITECTURE.md §6.2).
 *
 * Every method reads ONE explicitly authorized SUBJECT through a `admin_view_craftsman_*` function. Each of those calls
 * `app.require_view_as(subject)` first, so the database re-checks `users.view_as`, the subject's eligibility and rank, and
 * a live, audited session bound to this login on EVERY read. The production loaders (`loadPersonalHome`, `my_*`, …) are
 * not touched and never see the subject: they stay bound to the signed-in user.
 *
 * Reads only: nothing here calls a function that can write. A refusal (the session ended or expired between the page
 * guard and this read, the permission was revoked, the rank changed) is sent back to the user's admin page; any other
 * error surfaces as an error rather than rendering partial data.
 */
type Client = SupabaseClient<Database>;

export type CraftsmanViewReader = {
  dashboard(): Promise<DashboardData>;
  profile(): Promise<ProfileData>;
  portfolio(): Promise<PortfolioData>;
  work(): Promise<WorkData>;
  points(): Promise<PointsData>;
  reviews(): Promise<ReviewsData>;
};

function settle(subjectId: string, result: { data: unknown; error: { code?: string; message: string } | null }): unknown {
  if (result.error) {
    if (result.error.code === "42501") redirect(`/admin/users/${subjectId}`);
    throw new Error("view-as read failed");
  }
  return result.data;
}

export function craftsmanViewAsReader(supabase: Client, subjectId: string): CraftsmanViewReader {
  const p_subject = subjectId;
  return {
    async dashboard() {
      return parseDashboard(settle(subjectId, await supabase.rpc("admin_view_craftsman_dashboard", { p_subject })));
    },
    async profile() {
      return parseProfile(settle(subjectId, await supabase.rpc("admin_view_craftsman_profile", { p_subject })));
    },
    async portfolio() {
      return parsePortfolio(settle(subjectId, await supabase.rpc("admin_view_craftsman_portfolio", { p_subject })));
    },
    async work() {
      return parseWork(settle(subjectId, await supabase.rpc("admin_view_craftsman_work", { p_subject, p_limit: 25 })));
    },
    async points() {
      return parsePoints(settle(subjectId, await supabase.rpc("admin_view_craftsman_points", { p_subject, p_limit: 50 })));
    },
    async reviews() {
      return parseReviews(settle(subjectId, await supabase.rpc("admin_view_craftsman_reviews", { p_subject, p_limit: 50 })));
    },
  };
}
