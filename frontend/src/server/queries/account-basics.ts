import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { computeMandatoryBusinessSetup } from "@/server/queries/business-setup";

/**
 * Account basics (ADR-0026): the phone, location (governorate + town) and
 * specialties every account gives once, as onboarding steps. The specialty
 * list suits the account type (Craftsman trades, the Engineer list, or none). `my_account_basics` already counts
 * what the account holds elsewhere (a professional's trades, the business
 * location an owner gave in business onboarding; never an employer's branch,
 * never another persona's specialties), so nothing is asked twice.
 */
export const ACCOUNT_BASICS_PATH = "/onboarding/basics";

/**
 * Which personal specialty list the account answers (app.account_specialty_kind):
 * the Craftsman trades, the Engineer list, or none (business accounts answer
 * their business activity in business setup; Sales Team, Contractor and
 * Personal have no list yet).
 */
export type SpecialtyKind = "trades" | "engineer" | "none";

function specialtyKind(value: unknown): SpecialtyKind {
  return value === "trades" || value === "engineer" ? value : "none";
}

export type AccountBasics = {
  phone: string | null;
  governorate: string | null;
  city: string | null;
  cityCustom: string | null;
  specialtyKind: SpecialtyKind;
  specialties: string[];
};

export type MissingBasics = { phone: boolean; location: boolean; specialties: boolean };

type Client = SupabaseClient<Database>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export async function loadAccountBasics(supabase: Client): Promise<AccountBasics | null> {
  const { data, error } = await supabase.rpc("my_account_basics");
  if (error) throw new Error(`account basics read failed (code ${error.code ?? "unknown"})`);
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  return {
    phone: text(row.phone),
    governorate: text(row.governorate),
    city: text(row.city),
    cityCustom: text(row.cityCustom),
    specialtyKind: specialtyKind(row.specialtyKind),
    specialties: Array.isArray(row.specialties) ? row.specialties.filter((k): k is string => typeof k === "string") : [],
  };
}

export function missingBasics(basics: AccountBasics): MissingBasics {
  return {
    phone: !basics.phone,
    location: !basics.governorate || (!basics.city && !basics.cityCustom),
    // An account with no specialty list (Personal) is never asked for one.
    specialties: basics.specialtyKind !== "none" && basics.specialties.length === 0,
  };
}

export function hasMissingBasics(missing: MissingBasics): boolean {
  return missing.phone || missing.location || missing.specialties;
}

/**
 * True when a signed-in account still owes any of the three. Fails OPEN: a
 * read error never locks a person out of the app, it only skips the screen.
 */
export async function needsAccountBasics(supabase: Client): Promise<boolean> {
  try {
    // A business registration answers these inside its business setup (owner
    // decision 2026-10-29): until its first business exists, that wizard is
    // where it goes, never a separate page.
    if ((await computeMandatoryBusinessSetup(supabase)).required) return false;
    const basics = await loadAccountBasics(supabase);
    return basics ? hasMissingBasics(missingBasics(basics)) : false;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "account basics read failed");
    return false;
  }
}

/** The basics screen, carrying where the person was going (already sanitized by the caller). */
export function accountBasicsPath(destination: string): string {
  return destination && destination !== "/" ? `${ACCOUNT_BASICS_PATH}?next=${encodeURIComponent(destination)}` : ACCOUNT_BASICS_PATH;
}
