"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  membershipSetCapabilities,
  branchAssign,
  membershipSuspend,
  membershipActivate,
  membershipRevoke,
} from "@/server/actions/membership";
import { ROLE_PRESETS, type RolePresetKey } from "@/lib/org/roles";

/**
 * Server Actions the organization people screen binds to. Each translates
 * FormData → an existing trusted membership/invitation RPC. NO authorization is
 * decided here: the database RPCs enforce `org.members.manage`, no-escalation,
 * last-owner protection, and tenant matching, then we map the outcome to a
 * translation KEY. Errors are surfaced, never swallowed.
 */

export type PeopleFormState = {
  ok: boolean;
  code?: string;
  /** The generated invite link path, surfaced so the manager can share it. */
  inviteToken?: string;
};

function str(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

function mapPeopleError(message: string | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("org.members.manage")) return "org.error.notAuthorized";
  if (m.includes("already has a membership") || m.includes("already")) return "org.error.alreadyMember";
  if (m.includes("no aladdin account") || m.includes("account exists")) return "org.error.noAccount";
  if (m.includes("branch")) return "org.error.branch";
  if (m.includes("last owner")) return "org.error.lastOwner";
  if (m.includes("cannot grant")) return "org.error.cannotGrant";
  return "states.genericRetry";
}

/** Invite an employee by email (token-based `invitation_create`). */
export async function inviteMemberAction(
  _prev: PeopleFormState,
  fd: FormData,
): Promise<PeopleFormState> {
  const orgId = str(fd, "orgId");
  const email = str(fd, "email");
  const branchId = str(fd, "branchId");
  if (!orgId) return { ok: false, code: "states.genericRetry" };
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, code: "org.error.email" };
  }

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("invitation_create", {
    p_org_id: orgId,
    p_email: email,
    ...(branchId ? { p_primary_branch_id: branchId } : {}),
  });
  if (error) return { ok: false, code: mapPeopleError(error.message) };
  revalidatePath("/b2b/organization");
  return { ok: true, code: "org.invite.sent", inviteToken: typeof data === "string" ? data : undefined };
}

/** Assign a capability preset (role) to a member. */
export async function assignRoleAction(
  _prev: PeopleFormState,
  fd: FormData,
): Promise<PeopleFormState> {
  const membershipId = str(fd, "membershipId");
  const role = str(fd, "role") as RolePresetKey | undefined;
  if (!membershipId || !role || !(role in ROLE_PRESETS)) {
    return { ok: false, code: "states.genericRetry" };
  }
  const supabase = await getServerSupabase();
  try {
    await membershipSetCapabilities(supabase, membershipId, ROLE_PRESETS[role]);
  } catch (e) {
    return { ok: false, code: mapPeopleError((e as Error).message) };
  }
  revalidatePath("/b2b/organization");
  return { ok: true, code: "org.role.updated" };
}

/** Assign a branch scope to a member. */
export async function assignBranchAction(
  _prev: PeopleFormState,
  fd: FormData,
): Promise<PeopleFormState> {
  const membershipId = str(fd, "membershipId");
  const branchId = str(fd, "branchId");
  if (!membershipId || !branchId) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  try {
    await branchAssign(supabase, membershipId, branchId);
  } catch (e) {
    return { ok: false, code: mapPeopleError((e as Error).message) };
  }
  revalidatePath("/b2b/organization");
  return { ok: true, code: "org.branch.assigned" };
}

/** Suspend / reactivate / revoke a membership. */
export async function setMemberStatusAction(
  _prev: PeopleFormState,
  fd: FormData,
): Promise<PeopleFormState> {
  const membershipId = str(fd, "membershipId");
  const op = str(fd, "op");
  if (!membershipId || !op) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  try {
    if (op === "suspend") await membershipSuspend(supabase, membershipId);
    else if (op === "activate") await membershipActivate(supabase, membershipId);
    else if (op === "revoke") await membershipRevoke(supabase, membershipId);
    else return { ok: false, code: "states.genericRetry" };
  } catch (e) {
    return { ok: false, code: mapPeopleError((e as Error).message) };
  }
  revalidatePath("/b2b/organization");
  return { ok: true, code: "org.status.updated" };
}
