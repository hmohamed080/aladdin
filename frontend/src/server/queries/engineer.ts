import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadPersonalHome } from "@/server/queries/personal-home";
import {
  getRegistrationState,
  hasAppAccess,
} from "@/server/queries/registration";
import { loadWorkspaces } from "@/server/queries/workspace";
import { personalEntry } from "@/lib/workspace/model";
import {
  listOrganizations,
  listProfessionals,
} from "@/server/queries/directory";
import { listCatalog } from "@/server/queries/commerce";
import { listMyRequests } from "@/server/queries/purchase-requests";
import { listMyPortfolio } from "@/server/queries/portfolio";
import { loadMyIdentity } from "@/server/queries/profile-identity";
import { isEngineer } from "@/features/engineer/links";
import { createAssetReadUrl } from "@/server/actions/professional-assets";

/** Guard each production route; neither a URL nor a hidden navigation item grants access. */
export const requireEngineer = cache(async () => {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (!hasAppAccess(state)) redirect("/onboarding");
  const supabase = await getServerSupabase();
  const [account, workspaces] = await Promise.all([
    loadPersonalHome(),
    loadWorkspaces(supabase),
  ]);
  if (!account || !isEngineer(account) || !personalEntry(workspaces.entries))
    redirect("/home");
  return { account, supabase };
});

export async function loadEngineerDashboard() {
  const { account, supabase } = await requireEngineer();
  const [requests, showrooms, professionals, products, portfolio, identity] =
    await Promise.all([
      listMyRequests(supabase, null, 6),
      listOrganizations(supabase, { types: ["showroom_dealer"] }),
      listProfessionals(supabase, {
        personas: ["engineer", "installer_technician"],
      }),
      listCatalog(supabase, null, { limit: 5 }),
      listMyPortfolio(),
      loadMyIdentity(),
    ]);
  return {
    account,
    requests,
    showrooms: showrooms.slice(0, 4),
    professionals: professionals.slice(0, 6),
    products,
    portfolio: await Promise.all(
      portfolio.slice(0, 4).map(async (item) => {
        const image = item.pending
          ? null
          : await createAssetReadUrl("portfolio", item.objectKey);
        return { ...item, imageUrl: image?.ok ? image.url : null };
      }),
    ),
    identity,
  };
}
export type EngineerDashboardData = Awaited<
  ReturnType<typeof loadEngineerDashboard>
>;

export async function loadEngineerInspiration(search?: string) {
  const { supabase } = await requireEngineer();
  let query = supabase
    .from("public_portfolio_items")
    .select("id, profile_id, title, description")
    .order("id")
    .limit(24);
  if (search?.trim())
    query = query.ilike(
      "title",
      `%${search.trim().slice(0, 100).replace(/[%_]/g, "")}%`,
    );
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).flatMap((p) =>
    p.id && p.profile_id && p.title
      ? [
          {
            id: p.id,
            profileId: p.profile_id,
            title: p.title,
            description: p.description,
          },
        ]
      : [],
  );
}
