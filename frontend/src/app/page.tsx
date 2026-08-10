import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { resolveActiveLanding } from "@/server/queries/landing";

export const dynamic = "force-dynamic";

/**
 * App entry. Middleware guarantees a session on protected routes, but `/` is
 * public, so an anonymous caller is sent to sign-in. A signed-in caller is
 * routed to their DERIVED destination (admin / workspace / consumer home) — the
 * B2B workspace is never assumed.
 */
export default async function RootPage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");
  redirect(await resolveActiveLanding(supabase));
}
