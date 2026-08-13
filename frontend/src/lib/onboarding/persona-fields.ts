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
 * Sprint 12: Engineer and Interior Designer became DISTINCT registration choices,
 * so each now maps to its own persona with a FIXED concrete type — the type is
 * asked once, at registration, and never again. The combined `engineer_designer`
 * persona is retained for saved drafts from before the split: it carries no fixed
 * type and still resolves through the in-flow sub-choice.
 */
export type ProfessionalPersona =
  | "engineer"
  | "interior_designer"
  | "engineer_designer"
  | "installer_technician"
  | "contractor"
  | "salesperson";

export const PERSONA_BY_ACCOUNT_TYPE: Partial<Record<AccountTypeValue, ProfessionalPersona>> = {
  engineer: "engineer",
  interior_designer: "interior_designer",
  installer_technician: "installer_technician",
  contractor: "contractor",
  sales: "salesperson",
};

/** The four individual professional types an upgrade may be requested for. */
export const INDIVIDUAL_PROFESSIONAL_TYPES: AccountTypeValue[] = [
  "engineer", "interior_designer", "installer_technician", "contractor", "sales",
];

/** Only the legacy combined persona needs a sub-choice; every current one is fixed. */
export const ENGINEER_DESIGNER_TYPES = ["engineer", "interior_designer"] as const;

/** The fixed concrete account type for a persona (null → resolved by sub-choice). */
export const FIXED_CONCRETE_TYPE: Record<ProfessionalPersona, AccountTypeValue | null> = {
  engineer: "engineer",
  interior_designer: "interior_designer",
  // Transitional: a draft saved before the Engineer/Interior Designer split.
  engineer_designer: null,
  installer_technician: "installer_technician",
  contractor: "contractor",
  salesperson: "sales",
};

/** 05.2.1 Identity — specialization options, keyed by the CONCRETE account type. */
export const SPECIALIZATIONS: Record<string, readonly string[]> = {
  engineer: ["structural", "mep", "site_supervision", "cost_estimation"],
  interior_designer: ["residential", "commercial", "kitchen_bath", "lighting_design"],
  installer_technician: ["kitchens_doors", "plumbing", "electrical", "hvac", "gypsum_paint"],
  contractor: ["full_finishing", "renovation", "turnkey", "specific_trades"],
  sales: ["showroom_sales", "field_sales", "technical_sales", "key_accounts"],
};

/** 05.2.2 Services & Skills — core + additional service pools, per concrete type. */
export const SERVICES: Record<string, readonly string[]> = {
  engineer: ["design_review", "structural_design", "supervision", "boq"],
  interior_designer: ["space_planning", "visualization", "material_selection", "styling"],
  installer_technician: ["kitchen_install", "door_install", "site_measurement"],
  contractor: ["finishing", "renovation", "turnkey_fitout"],
  sales: ["showroom_advice", "quotations", "product_demos"],
};

export const ADDITIONAL_SERVICES: Record<string, readonly string[]> = {
  engineer: ["consultation", "feasibility", "permits"],
  interior_designer: ["consultation", "procurement", "site_followup"],
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
