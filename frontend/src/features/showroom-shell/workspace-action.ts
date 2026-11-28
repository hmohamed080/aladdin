"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { loadWorkspaces } from "@/server/queries/workspace";
import { ORG_COOKIE, BRANCH_COOKIE, PERSONAL_CONTEXT } from "@/lib/workspace/model";
import { eligibleWorkspaces, personalWorkspace } from "./workspace-model";

// Mirrors selectWorkspace's membership boundary and cookie contract, but redirects
// only inside this suite. Production context actions are deliberately unchanged.
// PERSONAL_CONTEXT is accepted only when the caller really has a Personal workspace.
export async function selectShowroomWorkspace(value: string): Promise<{ error: boolean }> {
  const target = value === PERSONAL_CONTEXT ? z.literal(PERSONAL_CONTEXT).safeParse(value) : z.string().uuid().safeParse(value);
  if (!target.success || !hasAppAccess(await getRegistrationState())) return { error: true };
  const supabase = await getServerSupabase();
  const { entries } = await loadWorkspaces(supabase);
  const allowed = target.data === PERSONAL_CONTEXT
    ? personalWorkspace(entries) !== undefined
    : eligibleWorkspaces(entries).some((entry) => entry.organizationId === target.data);
  if (!allowed) return { error: true };
  const store = await cookies();
  store.set(ORG_COOKIE, target.data, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  store.delete(BRANCH_COOKIE);
  if (target.data === PERSONAL_CONTEXT) {
    revalidatePath("/", "layout");
    redirect("/home");
  }
  revalidatePath("/showroom", "layout");
  redirect("/showroom/home");
}
