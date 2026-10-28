/**
 * The canonical option taxonomy for individual persona onboarding (Sprint 7.4),
 * shared by the flow UIs (choice chips / selects) and the server actions (shape
 * validation). Keys are stable identifiers stored in `individual_onboarding`; the
 * human labels live in the i18n catalogs under `onboarding.consumer.*` /
 * `onboarding.professional.*` so nothing user-facing is hard-coded.
 *
 * Derived strictly from the canonical Consumer Onboarding (05.1.x) and
 * Professional Onboarding (05.2.x) designs — no invented fields.
 */
import type { Database } from "@/types/database.types";

/** A person's persona. A business classification is a different type entirely. */
export type AccountTypeValue = Database["public"]["Enums"]["persona_type"];

/* ---------------------------------- Consumer ---------------------------------- */

/** 05.1.1 Project Overview — usage intent. */
export const CONSUMER_INTENTS = ["explore", "planning", "started", "finishing", "need_help"] as const;
export type ConsumerIntent = (typeof CONSUMER_INTENTS)[number];

/** 05.1.2 Interests — category chips. */
export const CONSUMER_INTERESTS = [
  "flooring", "walls", "lighting", "kitchens", "bathrooms", "doors", "furniture", "interior_design",
] as const;

/** 05.1.4 Optional Budget — bands (EGP). */
export const CONSUMER_BUDGETS = ["lt_100k", "100_250k", "250_500k", "gt_500k", "not_decided"] as const;
export type ConsumerBudget = (typeof CONSUMER_BUDGETS)[number];

/* -------------------------------- Professional -------------------------------- */

/**
 * The professional persona is derived from the account type chosen at the shared
 * account-type step.
 *
 * Every persona maps to ONE fixed concrete type — the type is asked once, at
 * registration, and never again. (Engineer is the single engineer-related account;
 * the retired interior-designer and combined engineer/designer personas are gone.)
 */
export type ProfessionalPersona =
  | "engineer"
  | "installer_technician"
  | "contractor"
  | "salesperson";

export const PERSONA_BY_ACCOUNT_TYPE: Partial<Record<AccountTypeValue, ProfessionalPersona>> = {
  engineer: "engineer",
  installer_technician: "installer_technician",
  contractor: "contractor",
  sales: "salesperson",
};

/** The four individual professional types an upgrade may be requested for. */
export const INDIVIDUAL_PROFESSIONAL_TYPES: AccountTypeValue[] = [
  "engineer", "installer_technician", "contractor", "sales",
];

/** The fixed concrete account type for a persona. */
export const FIXED_CONCRETE_TYPE: Record<ProfessionalPersona, AccountTypeValue> = {
  engineer: "engineer",
  installer_technician: "installer_technician",
  contractor: "contractor",
  salesperson: "sales",
};

/** 05.2.1 Identity — specialization options, keyed by the CONCRETE account type. */
export const SPECIALIZATIONS: Record<string, readonly string[]> = {
  engineer: ["architecture", "civil"],
  installer_technician: ["kitchens_doors", "plumbing", "electrical", "hvac", "gypsum_paint"],
  contractor: ["full_finishing", "renovation", "turnkey", "specific_trades"],
  sales: ["showroom_sales", "field_sales", "technical_sales", "key_accounts"],
};

/** 05.2.2 Services & Skills — core + additional service pools, per concrete type. */
export const SERVICES: Record<string, readonly string[]> = {
  engineer: ["design_2d", "design_3d", "finishing", "construction", "consultation", "general_contracting"],
  installer_technician: ["kitchen_install", "door_install", "site_measurement"],
  contractor: ["finishing", "renovation", "turnkey_fitout"],
  sales: ["showroom_advice", "quotations", "product_demos"],
};

export const ADDITIONAL_SERVICES: Record<string, readonly string[]> = {
  // Engineer software skills use the existing supplemental-skills array.
  // Namespaced keys keep tools distinct from service keys and retain legacy values.
  engineer: ["tool_autocad", "tool_3ds_max"],
  installer_technician: ["maintenance", "finishing", "consultation"],
  contractor: ["demolition", "waterproofing", "consultation"],
  sales: ["site_visits", "after_sales", "key_accounts"],
};

/** 05.2.2 — languages (also written to profiles.languages). */
export const LANGUAGES = ["arabic", "english", "french"] as const;

/** 05.2.2 — availability. */
export const AVAILABILITIES = ["within_week", "within_month", "flexible"] as const;
export type Availability = (typeof AVAILABILITIES)[number];

/* ---------------------------------- Location ---------------------------------- */

/** Egyptian governorates → general cities/areas (shared by consumer + professional). */
export const GOVERNORATES = ["cairo", "giza", "alexandria", "qalyubia"] as const;
export type Governorate = (typeof GOVERNORATES)[number];

export const CITIES_BY_GOVERNORATE: Record<Governorate, readonly string[]> = {
  cairo: ["nasr_city", "new_cairo", "maadi", "heliopolis", "downtown"],
  giza: ["sheikh_zayed", "dokki", "mohandessin", "october_6"],
  alexandria: ["smouha", "miami", "sidi_gaber"],
  qalyubia: ["shibin", "banha", "qalyub"],
};

/** 05.2.3 — max travel distance options (km). */
export const MAX_TRAVEL_KM = [10, 20, 30, 50, 100] as const;

/* --------------------------------- Validators --------------------------------- */

export function isGovernorate(v: string): v is Governorate {
  return (GOVERNORATES as readonly string[]).includes(v);
}

/** All concrete cities across governorates (for validating a stored city value). */
export const ALL_CITIES: readonly string[] = GOVERNORATES.flatMap((g) => CITIES_BY_GOVERNORATE[g]);
