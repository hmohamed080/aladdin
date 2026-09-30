import { redirect } from "next/navigation";
import { requireAdminRoute } from "@/server/authorization/admin";

export const dynamic = "force-dynamic";

/**
 * Retired in Admin Core Phase 1B-A: this route ran its own 200-row snapshot
 * of the Organizations directory. PD-016 promotes the approved Admin Preview instead of keeping
 * a second implementation, so the classic route now forwards to the promoted,
 * server-paginated page (same `organizations.read` guard, checked here first).
 */
export default async function AdminOrganizationsPage() {
  await requireAdminRoute("/admin/organizations");
  redirect("/admin/preview/organizations");
}
