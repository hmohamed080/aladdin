import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { SuspendedPanel } from "@/features/auth/suspended-panel";

export const dynamic = "force-dynamic";

/**
 * Where a suspended account lands (PD-010, Admin Core 1B-B). The database
 * refuses every other request this account makes, so nothing here reads its
 * data; the middleware sends active accounts away from this page.
 */
export default async function AccountSuspendedPage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");
  return <SuspendedPanel />;
}
