"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ORG_COOKIE, BRANCH_COOKIE } from "@/server/queries/context";

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
