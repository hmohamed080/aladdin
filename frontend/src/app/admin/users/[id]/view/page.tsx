import { requireAdminRoute } from "@/server/authorization/admin";
import { getServerSupabase } from "@/lib/supabase/server";
import { requireViewAs } from "@/server/view-as/guard";
import { craftsmanViewAsReader } from "@/server/view-as/readers";
import { DashboardSection } from "@/features/admin-view-as/craftsman-sections";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Admin View-As — craftsman dashboard (read-only). The gate is re-established here: layouts are not re-run on soft navigation. */
export default async function ViewAsDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminRoute("/admin/users");
  const { id } = await params;
  const session = await requireViewAs(id);
  const reader = craftsmanViewAsReader(await getServerSupabase(), session.subjectUserId);
  return <DashboardSection data={await reader.dashboard()} />;
}
