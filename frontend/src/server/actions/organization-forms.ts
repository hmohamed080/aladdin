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
import { toE164 } from "@/lib/contact/phone";

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
  /** Which contact the invitation was addressed to, for the success copy. */
  channel?: "email" | "phone";
  /**
   * The NORMALIZED number a phone invitation was issued to (E.164), echoed back
   * so the success state can address WhatsApp at the same number the invitation
   * is bound to rather than at the raw string someone typed. Absent on the email
   * channel. This is the inviter's own input coming back to them — no lookup, no
   * disclosure — and never the token.
   */
  phone?: string;
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
  if (m.includes("valid phone")) return "org.error.phone";
  if (m.includes("exactly one of email or phone")) return "org.error.contactRequired";
  if (m.includes("branch")) return "org.error.branch";
  if (m.includes("last owner")) return "org.error.lastOwner";
  if (m.includes("cannot grant")) return "org.error.cannotGrant";
  return "states.genericRetry";
}

/**
 * Invite an employee, addressed to EITHER an email or a phone number.
 *
 * The channel is the inviter's choice because it is the invitee's constraint: a
 * branch salesperson or a fitter is reachable on WhatsApp and often has no work
 * email, and "get an email address first" is where adding your team stalls.
 * Exactly one target is submitted — the form sends the field for the selected
 * channel and nothing for the other — and the database enforces that same
 * exactly-one rule, so a hand-built request cannot create an ambiguous row.
 *
 * DELIVERY, STATED HONESTLY
 * Email invitations reuse the existing email path. There is NO SMS or WhatsApp
 * sending configured in this deployment, so a phone invitation is created,
 * persisted and tokenized, and the manager is handed the link to send through
 * whichever channel they already use with that person. Nothing in this action,
 * or in the copy it returns, claims a message was sent — a "sent" toast for a
 * message that was never dispatched is the worst outcome available here, because
 * the manager stops chasing an invitee who was never contacted.
 *
 * The success state carries the normalized number back so the UI can offer a
 * WhatsApp hand-off (`lib/contact/whatsapp`). That is still a link that OPENS
 * WhatsApp with the message typed; the human presses Send. No messaging service
 * is involved on this path, here or anywhere downstream of it.
 */
export async function inviteMemberAction(
  _prev: PeopleFormState,
  fd: FormData,
): Promise<PeopleFormState> {
  const orgId = str(fd, "orgId");
  const channel = str(fd, "channel") === "phone" ? "phone" : "email";
  const branchId = str(fd, "branchId");
  if (!orgId) return { ok: false, code: "states.genericRetry" };

  let target: { p_email: string } | { p_phone: string };
  let normalizedPhone: string | undefined;
  if (channel === "phone") {
    const phone = toE164(str(fd, "phone") ?? "");
    if (!phone) return { ok: false, code: "org.error.phone" };
    normalizedPhone = phone;
    target = { p_phone: phone };
  } else {
    const email = str(fd, "email");
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { ok: false, code: "org.error.email" };
    }
    target = { p_email: email };
  }

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("invitation_create", {
    p_org_id: orgId,
    ...target,
    ...(branchId ? { p_primary_branch_id: branchId } : {}),
  });
  if (error) return { ok: false, code: mapPeopleError(error.message) };
  revalidatePath("/b2b/organization");
  return {
    ok: true,
    // Two different truths, two different strings. Email really was dispatched;
    // a phone invitation is ready to be shared and says exactly that.
    code: channel === "phone" ? "org.invite.ready" : "org.invite.sent",
    inviteToken: typeof data === "string" ? data : undefined,
    channel,
    phone: normalizedPhone,
  };
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
