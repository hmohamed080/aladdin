import { requireAdminRoute } from "@/server/authorization/admin";
import { requireViewAs } from "@/server/view-as/guard";
import { ViewAsLanding } from "@/features/admin-view-as/view-as-landing";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ViewAsLandingPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminRoute("/admin/users");
  const { id } = await params;
  const session = await requireViewAs(id);
  return <ViewAsLanding kind={session.kind} />;
}
