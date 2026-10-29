"use server";

import { redirect } from "next/navigation";
import type { CountryCode } from "libphonenumber-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { toCanonicalPhone, splitE164, DEFAULT_PHONE_COUNTRY } from "@/lib/contact/phone";
import { validateBusinessLocation } from "@/lib/location/business-location";
import { readSessionIdentity } from "@/server/auth/session";
import { sanitizeNext } from "@/server/auth/next";
import { resolveActiveLanding } from "@/server/queries/landing";
import { loadAccountBasics, missingBasics } from "@/server/queries/account-basics";

/**
 * Saves the "Complete your account" screen (ADR-0026). Only the parts the
 * account is still missing are read from the form, so a value it already holds
 * can never be overwritten from here. The database re-checks everything:
 * profile_set_phone for the phone, account_basics_set for the location
 * (catalogue) and specialties (active trades).
 */
export type AccountBasicsState = { ok: boolean; code?: string; field?: "phone" | "location" | "specialties" };

const error = (field: AccountBasicsState["field"], code: string): AccountBasicsState => ({
  ok: false,
  field,
  code: `accountBasics.error.${code}`,
});

export async function saveAccountBasics(_prev: AccountBasicsState, formData: FormData): Promise<AccountBasicsState> {
  const supabase = await getServerSupabase();
  const user = await readSessionIdentity(supabase);
  if (!user) redirect("/auth/sign-in");

  const basics = await loadAccountBasics(supabase).catch(() => null);
  if (!basics) return error(undefined, "saveFailed");
  const missing = missingBasics(basics);

  let phone: ReturnType<typeof toCanonicalPhone> = null;
  if (missing.phone) {
    const national = String(formData.get("phone") ?? "").trim();
    if (!national) return error("phone", "phoneRequired");
    const country = (String(formData.get("phoneCountry") ?? "") || DEFAULT_PHONE_COUNTRY) as CountryCode;
    phone = toCanonicalPhone(national, country);
    if (!phone) return error("phone", "phoneInvalid");
  }

  let location: { governorate: string; city: string | null; cityCustomName: string | null } | null = null;
  if (missing.location) {
    const checked = validateBusinessLocation(
      {
        governorate: String(formData.get("governorate") ?? ""),
        city: String(formData.get("city") ?? ""),
        cityCustomName: String(formData.get("cityCustom") ?? ""),
      },
      { complete: true },
    );
    if (!checked.ok || !checked.value.governorate) return error("location", checked.ok ? "locationRequired" : "locationInvalid");
    location = { governorate: checked.value.governorate, city: checked.value.city, cityCustomName: checked.value.cityCustomName };
  }

  let specialties: string[] | null = null;
  if (missing.specialties) {
    specialties = formData.getAll("specialties").map((v) => String(v).trim()).filter(Boolean);
    if (specialties.length === 0) return error("specialties", "specialtiesRequired");
  }

  const written = await writeBasics(supabase, phone, location, specialties);
  if (!written.ok) return written;

  const landing = await resolveActiveLanding(supabase);
  const next = sanitizeNext(formData.get("next"));
  redirect(next === landing || next.startsWith(`${landing}/`) ? next : landing);
}

type Client = Awaited<ReturnType<typeof getServerSupabase>>;
type Location = { governorate: string; city: string | null; cityCustomName: string | null } | null;

/** Writes what was given: the phone through profile_set_phone, location and specialties through account_basics_set. */
async function writeBasics(supabase: Client, phone: ReturnType<typeof toCanonicalPhone>, location: Location, specialties: string[] | null): Promise<AccountBasicsState> {
  if (phone) {
    const { error: phoneError } = await supabase.rpc("profile_set_phone", {
      p_country_iso2: phone.countryIso2,
      p_national: phone.national,
      p_e164: phone.e164,
    });
    if (phoneError) {
      console.error(`account basics: phone failed (code ${phoneError.code ?? "unknown"})`);
      return error("phone", phoneError.code === "23505" ? "phoneTaken" : "phoneInvalid");
    }
  }

  if (location || specialties) {
    const { error: basicsError } = await supabase.rpc("account_basics_set", {
      p_governorate: location?.governorate ?? (null as unknown as string),
      p_city: location?.city ?? (null as unknown as string),
      p_city_custom: location?.cityCustomName ?? (null as unknown as string),
      p_specialties: specialties ?? (null as unknown as string[]),
    });
    if (basicsError) {
      console.error(`account basics: save failed (code ${basicsError.code ?? "unknown"})`);
      if (basicsError.code === "22023") {
        return /specialt/i.test(basicsError.message ?? "") ? error("specialties", "specialtiesRequired") : error("location", "locationInvalid");
      }
      return error(undefined, "saveFailed");
    }
  }

  return { ok: true };
}

/**
 * The basics step inside business setup (owner decision 2026-10-29): the
 * owner's mobile number (and a personal specialty list, when the account has one), when still missing.
 * The location comes from the business itself (my_account_basics reads an
 * owner's primary branch), so it is never asked here. Saves only what the
 * account still lacks; the database re-checks everything.
 */
export async function saveBusinessBasicsStep(input: { phone: string | null; specialties: string[] }): Promise<AccountBasicsState> {
  const supabase = await getServerSupabase();
  const user = await readSessionIdentity(supabase);
  if (!user) redirect("/auth/sign-in");

  const basics = await loadAccountBasics(supabase).catch(() => null);
  if (!basics) return error(undefined, "saveFailed");
  const missing = missingBasics(basics);

  let phone: ReturnType<typeof toCanonicalPhone> = null;
  if (missing.phone) {
    const split = splitE164(input.phone);
    phone = split ? toCanonicalPhone(split.national, split.countryIso2) : null;
    if (!phone) return error("phone", input.phone ? "phoneInvalid" : "phoneRequired");
  }

  let specialties: string[] | null = null;
  if (missing.specialties) {
    specialties = input.specialties.map((v) => v.trim()).filter(Boolean);
    if (specialties.length === 0) return error("specialties", "specialtiesRequired");
  }

  return writeBasics(supabase, phone, null, specialties);
}
