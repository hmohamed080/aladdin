"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaces } from "@/server/queries/workspace";
import { ORG_COOKIE, BRANCH_COOKIE, PERSONAL_CONTEXT } from "@/lib/workspace/model";

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Records the caller's preferred active org/branch in cookies. This is a UI
 * preference only — it grants NO authority. Every read/write is still RLS-scoped
 * and the RPCs re-check membership + branch access, so a cookie naming an
 * out-of-scope org/branch simply yields empty results or a server-side denial.
 */
export async function selectOrganization(orgId: string): Promise<void> {
  const store = await cookies();
  store.set(ORG_COOKIE, orgId, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
  // Changing org invalidates any previously chosen branch.
  store.delete(BRANCH_COOKIE);
  revalidatePath("/b2b", "layout");
}

export async function selectBranch(branchId: string): Promise<void> {
  const store = await cookies();
  if (branchId === "all") {
    store.delete(BRANCH_COOKIE);
  } else {
    store.set(BRANCH_COOKIE, branchId, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
  }
  revalidatePath("/b2b", "layout");
}

/**
 * Switch the active WORK CONTEXT — Personal or one of the caller's businesses.
 * This changes where the caller is working, never who they are: it does not touch
 * `users.primary_account_type`, does not add or remove a membership, and grants no
 * access. It is validated against the caller's real contexts, so a value naming a
 * workspace they do not have (or a membership that has since been suspended or
 * revoked) is refused and resolves safely instead.
 *
 * The previously chosen branch is always cleared: a branch is only meaningful
 * inside one organization, and carrying it across would be a cross-tenant leak
 * waiting to happen.
 */
export async function selectWorkspace(value: string): Promise<void> {
  const supabase = await getServerSupabase();
  const { entries } = await loadWorkspaces(supabase);

  const target =
    value === PERSONAL_CONTEXT
      ? entries.find((e) => e.kind === "personal") && PERSONAL_CONTEXT
      : entries.find((e) => e.kind === "business" && e.organizationId === value) && value;

  const store = await cookies();
  if (!target) {
    // Not a workspace this caller has. Drop the selection and let the deterministic
    // resolver land them somewhere valid.
    store.delete(ORG_COOKIE);
    store.delete(BRANCH_COOKIE);
    redirect("/");
  }

  store.set(ORG_COOKIE, target, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
  store.delete(BRANCH_COOKIE);
  revalidatePath("/", "layout");
  redirect(target === PERSONAL_CONTEXT ? "/home" : "/b2b");
}
