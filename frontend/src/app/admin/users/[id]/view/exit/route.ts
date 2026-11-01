import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Return to admin": ends the CALLER's own view session for this subject (audited) and goes back to the user's admin
 * page. A POST route handler, not a server action, so the read-only tree stays free of actions. It only ever touches the
 * caller's own session rows (`admin_view_as_end` is scoped to `auth.uid()`), is allowed even after the permission was
 * revoked, and refuses a cross-site POST.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse(null, { status: 404 });

  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return new NextResponse(null, { status: 403 });

  const supabase = await getServerSupabase();
  await supabase.rpc("admin_view_as_end", { p_subject: id, p_kind: "craftsman" });

  const res = NextResponse.redirect(new URL(`/admin/users/${id}`, request.nextUrl.origin), 303);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
