import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { parseLimitRows } from "@/lib/media/limits";

export const dynamic = "force-dynamic";

/**
 * The stored upload limits, for the browser to use as HINTS (the server and the database check the stored value again).
 * Signed-in users only: uploads need a session anyway, and the database function refuses anonymous callers.
 */
export async function GET() {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("media_limits_get");
  if (error) return NextResponse.json({ error: "unavailable" }, { status: error.code === "42501" ? 401 : 503, headers: { "cache-control": "private, no-store" } });
  return NextResponse.json(parseLimitRows(data), { headers: { "cache-control": "private, max-age=30" } });
}
