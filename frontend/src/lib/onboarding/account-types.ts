/**
 * The canonical mapping of registration CHOICES to the database `account_type`
 * enum + `onboarding_track`. Shared by the server actions (validation) and the UI
 * (grouped cards) so the two can never drift.
 *
 * The choice is presented as a direct question — Personal or Business — and the
 * two groups mean structurally different things:
 *
 *   PERSONAL  -> `users.primary_account_type` (a persona: who you are).
 *   BUSINESS  -> `organizations.org_type` (a classification: what you are creating).
 *
 * Choosing "Showroom / Dealer" therefore means "create a business whose
 * organizations.org_type is showroom_dealer". It NEVER means
 * `users.primary_account_type = 'showroom_dealer'` — that conflation is exactly
 * the debt this sprint removes. A business choice records the type as INTENT on
 * `onboarding_progress` and carries it into the business draft; the person keeps
 * no personal persona unless they claim one.
 *
 * "Invited organization employee" is not a public choice — it is joined via an
 * invitation token, so it is modelled separately (`INVITED_EMPLOYEE`) and never
 * sent to the account-type RPC.
 */
export type OnboardingTrack = "consumer" | "professional" | "business";

/** Personal personas a person may claim at registration. */
export type PersonalPersona =
  | "end_consumer"
  | "engineer"
  | "interior_designer"
  | "installer_technician"
  | "contractor"
  | "sales";

/**
 * `organization_type` values that are no longer offered to a new
 * registration but can still be stored on a legacy `onboarding_progress`
 * row (registration INTENT, never remapped by Increment 4 — that migration
 * only remaps `organizations.org_type`). Needed purely so a transitional
 * choice's `accountType` still type-checks against what a legacy row can
 * genuinely hold.
 */
type LegacyBusinessOrgType = "wholesaler";

export type AccountTypeChoice = {
  /** Stable key used as the form value + i18n key suffix. */
  key: string;
  track: OnboardingTrack;
  /** Concrete DB account_type — a persona (personal) or an org_type (business). */
  accountType: PersonalPersona | BusinessOrgType | LegacyBusinessOrgType | null;
  /**
   * Superseded choices kept ONLY so a saved draft still resolves to a label on
   * resume. Never rendered as a new-registration option.
   */
  transitional?: true;
  /**
   * Visible but not yet open for new-registration self-service (shown disabled
   * with a "Coming soon" state). The architecture already represents these as
   * real persona/org types — only the self-service registration path is gated.
   * Never selectable client-side, and rejected server-side in
   * `selectAccountTypeAction` as defense in depth.
   */
  comingSoon?: true;
};

/** The invitation-only path is not selectable through public registration. */
export const INVITED_EMPLOYEE_KEY = "invited_employee";

/**
 * The concrete business `org_type` values a new organization may be created as.
 * These mirror the `ck_bcd_org_type` constraint in the database — the UI never
 * offers a taxonomy the schema cannot store. (An individual Contractor is a
 * PERSONAL persona, not a business type; there is no contractor `org_type`, so
 * none is offered here.)
 */
/**
 * `wholesaler` is deliberately absent — Staging-prep Increment 4
 * (20260924090004_wholesaler_supplier_remap.sql) remaps every existing
 * wholesaler organization to `supplier` + a `wholesaler` activity row and
 * stops offering it as a new choice. The enum value itself still exists in
 * the database (unused, same precedent as `contractor_company`/
 * `design_office`) — only this picker changed.
 */
export const BUSINESS_ORG_TYPES = [
  "showroom_dealer",
  "supplier",
  "manufacturer",
  "importer",
] as const;
export type BusinessOrgType = (typeof BUSINESS_ORG_TYPES)[number];

export function isBusinessOrgType(value: string | null | undefined): value is BusinessOrgType {
  return !!value && (BUSINESS_ORG_TYPES as readonly string[]).includes(value);
}

/**
 * Carry the business type chosen at registration into the business draft, so the
 * concrete type is never asked twice.
 */
export function businessOrgTypeFromAccountType(
  accountType: string | null | undefined,
): BusinessOrgType | null {
  return isBusinessOrgType(accountType) ? accountType : null;
}

/**
 * The 9 approved top-level audiences (staging-prep taxonomy correction). Key
 * names are unchanged from before to avoid a wider blast radius — only the
 * MEMBERSHIP of this list and its i18n labels changed:
 *
 *   1. Showroom (showroom_dealer, business)      6. Engineer — Coming Soon
 *   2. Supplier (business)                       7. Tradespeople & Technicians
 *   3. Manufacturer (business)                       (key: installer_technician —
 *   4. Importer (business)                            relabeled only, never a
 *   5. Contractor — Coming Soon                        standalone "Installer" type)
 *                                                 8. Sales Team (key: salesperson)
 *                                                 9. Personal Account — Coming Soon
 *                                                    (key: end_consumer; means ONLY
 *                                                    homeowner/end-consumer)
 */
export const ACCOUNT_TYPE_CHOICES: AccountTypeChoice[] = [
  // ---- Personal: a persona the person claims for themselves. ----
  { key: "end_consumer", track: "consumer", accountType: "end_consumer", comingSoon: true },
  { key: "engineer", track: "professional", accountType: "engineer", comingSoon: true },
  { key: "installer_technician", track: "professional", accountType: "installer_technician" },
  { key: "contractor", track: "professional", accountType: "contractor", comingSoon: true },
  { key: "salesperson", track: "professional", accountType: "sales" },
  // ---- Business: the org_type of the business being created. ----
  { key: "showroom_dealer", track: "business", accountType: "showroom_dealer" },
  { key: "supplier", track: "business", accountType: "supplier" },
  { key: "manufacturer", track: "business", accountType: "manufacturer" },
  { key: "importer", track: "business", accountType: "importer" },
  // ---- Transitional: resume-only, never offered to a new registration. ----
  { key: "interior_designer", track: "professional", accountType: "interior_designer", transitional: true },
  { key: "engineer_designer", track: "professional", accountType: "engineer", transitional: true },
  // accountType stays literally "wholesaler" (not remapped to "supplier")
  // because this resolves onboarding_progress.selected_org_type — registration
  // INTENT, a different, untouched table from organizations.org_type, which
  // Increment 4 remaps. A legacy row genuinely still holds "wholesaler" here.
  { key: "wholesaler", track: "business", accountType: "wholesaler", transitional: true },
  {
    key: "manufacturer_importer_wholesaler",
    track: "business",
    accountType: "manufacturer",
    transitional: true,
  },
  { key: "organization_owner_manager", track: "business", accountType: null, transitional: true },
];

export const CHOICES_BY_KEY: Record<string, AccountTypeChoice> = Object.fromEntries(
  ACCOUNT_TYPE_CHOICES.map((c) => [c.key, c]),
);

/**
 * The selection UI, as a direct Personal-or-Business question. Order is preserved
 * and transitional keys are excluded — a new registration is never offered
 * "Organization owner / manager", because owner is a relationship created by
 * making a business, not something to pick from a list.
 */
export const CHOICE_GROUPS: { group: "personal" | "business"; keys: string[] }[] = [
  {
    group: "personal",
    keys: [
      "end_consumer",
      "engineer",
      "installer_technician",
      "contractor",
      "salesperson",
    ],
  },
  { group: "business", keys: [...BUSINESS_ORG_TYPES] },
];
