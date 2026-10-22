import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { SecurityActor, SessionOps } from "@/server/auth/installer-security";

/**
 * The trusted caller of a security-sensitive account change, read from the request's own session (never a form), plus
 * the session operations the orchestration needs. The user id and login email come ONLY from `auth.getUser()`.
 */
export async function resolveSecuritySession(
  supabase: SupabaseClient<Database>,
): Promise<{ actor: SecurityActor | null; session: SessionOps }> {
  const session: SessionOps = {
    refreshSession: async () => {
      const { error } = await supabase.auth.refreshSession();
      if (error) throw error;
    },
    endOtherSessions: async () => {
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) throw error;
    },
    // The caller's OWN session changes the password, so the session making the request survives it. Both values: with
    // GoTrue's require-current-password setting on, Auth verifies the current password atomically with the update.
    updatePassword: async (password, currentPassword) => {
      const { error } = await supabase.auth.updateUser({ password, current_password: currentPassword });
      return {
        error: error ? { status: (error as { status?: number }).status, code: (error as { code?: string }).code, name: error.name } : null,
      };
    },
  };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { actor: null, session };
  const { data: profile } = await supabase.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle();
  return { actor: { userId: user.id, loginEmail: user.email, displayName: profile?.display_name ?? null }, session };
}
