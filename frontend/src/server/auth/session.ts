import "server-only";

import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";

/** The verified caller, or null when signed out. Never trusts client input. */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Require a signed-in caller; redirect to sign-in (preserving destination) otherwise. */
export async function requireUser(nextPath: string): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/auth/sign-in?next=${encodeURIComponent(nextPath)}`);
  }
  return user;
}
