import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { isViewAsEnabled } from "@/lib/env/view-as";
import { can } from "@/lib/permissions/admin";
import { loadAdminAccess } from "@/server/authorization/admin";
import { parseViewAsSession } from "@/server/view-as/guard";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const refuse = (status: number) => {
  const res = new NextResponse(null, { status });
  res.headers.set("Cache-Control", "private, no-store");
  return res;
};

/**
 * Open the audited read-only view session — the ONLY place one is started (the page guard merely reads it).
 *
 * A deliberate same-origin POST from the user's admin page (the eye). It refuses a cross-site request by `Origin` and by
 * `Sec-Fetch-Site`, so a link, image or form on another site cannot make an admin's browser start a session or write an
 * `admin.view_as.started` audit row. Everything else is judged by the database in `admin_view_as_begin` (permission,
 * subject eligibility and rank, one live session per admin + subject, one audit row per NEW session). Any refusal is the
 * same 404.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isViewAsEnabled() || !UUID.test(id)) return refuse(404);

  const origin = request.headers.get("origin");
  if (origin !== request.nextUrl.origin) return refuse(403);
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return refuse(403);

  const access = await loadAdminAccess();
  if (!access.isStaff || !can(access, "users.view_as")) return refuse(404);

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("admin_view_as_begin", { p_subject: id, p_kind: "craftsman" });
  const session = error ? null : parseViewAsSession(data);
  if (!session || session.subjectUserId !== id) return refuse(404);

  const res = NextResponse.redirect(new URL(`/admin/users/${id}/view`, request.nextUrl.origin), 303);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
