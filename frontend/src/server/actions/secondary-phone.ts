"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import type { IdentityFieldState } from "@/server/actions/profile-identity";

/**
 * The unverified second phone (V1, no OTP). Every rule lives in the database
 * (20261021090004_secondary_phone_reservations.sql): one reservation per
 * account, 7 days plus one 7-day renewal, global uniqueness against every
 * primary and secondary claim, the 30-day cooldown, and the current-password
 * receipt (single-use, 60 seconds, bound to user + operation + number, 5 wrong
 * passwords in 15 minutes lock it for 15 minutes). These actions only confirm
 * the password, forward the receipt, and map the outcome to a translation key.
 */

const E164 = /^\+[1-9][0-9]{7,14}$/;
const SETTINGS_PATHS = ["/home/settings", "/b2b/settings", "/settings/profile", "/showroom/settings"] as const;

type Operation = "secondary_phone.reserve" | "secondary_phone.change" | "secondary_phone.convert";
type Client = Awaited<ReturnType<typeof getServerSupabase>>;

function field(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function revalidate() {
  for (const path of SETTINGS_PATHS) revalidatePath(path);
}

/** Confirm the current password for one operation on one number; returns the receipt or a translation key. */
async function confirmPassword(supabase: Client, password: string, operation: Operation, target: string) {
  if (!password) return { ok: false as const, code: "profileIdentity.secondaryPhone.errors.passwordRequired" };
  const { data, error } = await supabase.rpc("account_password_confirm", {
    p_password: password,
    p_operation: operation,
    p_target: target,
  });
  if (error) return { ok: false as const, code: "profileIdentity.secondaryPhone.errors.generic" };
  const r = (data ?? {}) as { ok?: boolean; receipt?: string; reason?: string };
  if (r.ok && typeof r.receipt === "string") return { ok: true as const, receipt: r.receipt };
  const reason = r.reason === "locked" || r.reason === "no_password" ? r.reason : "wrong_password";
  const code = {
    locked: "profileIdentity.secondaryPhone.errors.locked",
    no_password: "profileIdentity.secondaryPhone.errors.noPassword",
    wrong_password: "profileIdentity.secondaryPhone.errors.wrongPassword",
  }[reason];
  return { ok: false as const, code };
}

/** Database outcome → translation key. Conflicts stay generic: they never say who holds a number. */
function mapError(error: { code?: string; message?: string }): string {
  const msg = error.message ?? "";
  if (error.code === "55P03") return "profileIdentity.secondaryPhone.errors.cooldown";
  if (msg.includes("already have a secondary phone")) return "profileIdentity.secondaryPhone.errors.alreadyHave";
  if (msg.includes("already your primary")) return "profileIdentity.secondaryPhone.errors.alreadyPrimary";
  if (msg.includes("already your secondary")) return "profileIdentity.secondaryPhone.errors.samePhone";
  if (msg.includes("renewed only once")) return "profileIdentity.secondaryPhone.errors.renewedOnce";
  if (msg.includes("phone identity changes")) return "profileIdentity.secondaryPhone.errors.loginPhone";
  if (error.code === "23505") return "profileIdentity.secondaryPhone.errors.unavailable";
  if (error.code === "P0002") return "profileIdentity.secondaryPhone.errors.gone";
  if (error.code === "22023") return "profileIdentity.secondaryPhone.errors.invalid";
  return "profileIdentity.secondaryPhone.errors.generic";
}

/** Add (mode=reserve) or replace (mode=change) the second phone. */
export async function saveSecondaryPhoneAction(_p: IdentityFieldState, fd: FormData): Promise<IdentityFieldState> {
  const e164 = field(fd, "e164");
  const mode = field(fd, "mode") === "change" ? "change" : "reserve";
  if (!E164.test(e164)) return { ok: false, code: "profileIdentity.secondaryPhone.errors.invalid" };
  const supabase = await getServerSupabase();
  const operation: Operation = mode === "change" ? "secondary_phone.change" : "secondary_phone.reserve";
  const confirmed = await confirmPassword(supabase, String(fd.get("password") ?? ""), operation, e164);
  if (!confirmed.ok) return { ok: false, code: confirmed.code };
  const { error } = await supabase.rpc(mode === "change" ? "secondary_phone_change" : "secondary_phone_reserve", {
    p_phone: e164,
    p_receipt: confirmed.receipt,
  });
  if (error) return { ok: false, code: mapError(error) };
  revalidate();
  return { ok: true, code: mode === "change" ? "profileIdentity.secondaryPhone.changed" : "profileIdentity.secondaryPhone.reserved" };
}

export async function renewSecondaryPhoneAction(): Promise<IdentityFieldState> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("secondary_phone_renew");
  if (error) return { ok: false, code: mapError(error) };
  revalidate();
  return { ok: true, code: "profileIdentity.secondaryPhone.renewed" };
}

export async function cancelSecondaryPhoneAction(): Promise<IdentityFieldState> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("secondary_phone_cancel");
  if (error) return { ok: false, code: mapError(error) };
  revalidate();
  return { ok: true, code: "profileIdentity.secondaryPhone.cancelled" };
}

export async function makeSecondaryPhonePrimaryAction(_p: IdentityFieldState, fd: FormData): Promise<IdentityFieldState> {
  const e164 = field(fd, "e164");
  if (!E164.test(e164)) return { ok: false, code: "profileIdentity.secondaryPhone.errors.invalid" };
  const supabase = await getServerSupabase();
  const confirmed = await confirmPassword(supabase, String(fd.get("password") ?? ""), "secondary_phone.convert", e164);
  if (!confirmed.ok) return { ok: false, code: confirmed.code };
  const countryIso2 = field(fd, "countryIso2");
  const national = field(fd, "national");
  const { error } = await supabase.rpc("secondary_phone_make_primary", {
    p_receipt: confirmed.receipt,
    p_country_iso2: /^[A-Z]{2}$/.test(countryIso2) ? countryIso2 : undefined,
    p_national: national || undefined,
  });
  if (error) return { ok: false, code: mapError(error) };
  revalidate();
  return { ok: true, code: "profileIdentity.secondaryPhone.madePrimary" };
}
