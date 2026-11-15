import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const refuse = (status: number) => {
  const res = new NextResponse(null, { status });
  res.headers.set("Cache-Control", "private, no-store");
  return res;
};

/**
 * "Return to admin": ends the CALLER's own view session for this subject (audited) and goes back to the user's admin
 * page. A POST route handler, not a server action, so the read-only tree stays free of actions.
 *
 * Same strict same-origin rule as Start: a missing, foreign or "null" Origin, or any fetch site other than
 * `same-origin`, is refused before the database is touched. `admin_view_as_end` only ever touches the caller's own
 * session rows and works even after the permission was revoked.
 *
 * The result is checked: a database error answers 500 and does NOT redirect as though the session had ended (the
 * session would still be live). `false` means there was no live session left (already ended, expired or never opened) —
 * the postcondition "no live session" holds, so the admin is returned to the user page.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return refuse(404);

  const origin = request.headers.get("origin");
  if (origin !== request.nextUrl.origin) return refuse(403);
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return refuse(403);

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("admin_view_as_end", { p_subject: id, p_kind: "craftsman" });
  if (error) return refuse(500);

  const res = NextResponse.redirect(new URL(`/admin/users/${id}`, request.nextUrl.origin), 303);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
