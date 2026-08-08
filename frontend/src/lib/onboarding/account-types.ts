/**
 * The canonical mapping of the shared-onboarding account-type CHOICES to the
 * database `account_type` enum + `onboarding_track`. Shared by the server actions
 * (validation) and the UI (grouped cards) so the two can never drift.
 *
 * Notes:
 * - "Organization owner/manager" has no `account_type` enum value (it is a role via
 *   org membership); its concrete type stays null and is chosen during org setup.
 * - "Invited organization employee" is NOT a public choice — it is joined via an
 *   invitation token, so it is modelled separately (`INVITED_EMPLOYEE`) and never
 *   sent to the account-type RPC.
 */
export type OnboardingTrack = "consumer" | "professional" | "business";

export type AccountTypeChoice = {
  /** Stable key used as the form value + i18n key suffix. */
  key: string;
  track: OnboardingTrack;
  /** Concrete DB account_type, or null (consumer / org owner-manager). */
  accountType:
    | "end_consumer"
    | "engineer"
    | "installer_technician"
    | "contractor"
    | "sales"
    | "showroom_dealer"
    | "supplier"
    | "manufacturer"
    | null;
};

/** The invitation-only path is not selectable through public registration. */
export const INVITED_EMPLOYEE_KEY = "invited_employee";

export const ACCOUNT_TYPE_CHOICES: AccountTypeChoice[] = [
  // Individual
  { key: "end_consumer", track: "consumer", accountType: "end_consumer" },
  { key: "engineer_designer", track: "professional", accountType: "engineer" },
  { key: "installer_technician", track: "professional", accountType: "installer_technician" },
  { key: "contractor", track: "professional", accountType: "contractor" },
  { key: "salesperson", track: "professional", accountType: "sales" },
  // Business
  { key: "showroom_dealer", track: "business", accountType: "showroom_dealer" },
  { key: "supplier", track: "business", accountType: "supplier" },
  { key: "manufacturer_importer_wholesaler", track: "business", accountType: "manufacturer" },
  { key: "organization_owner_manager", track: "business", accountType: null },
];

export const CHOICES_BY_KEY: Record<string, AccountTypeChoice> = Object.fromEntries(
  ACCOUNT_TYPE_CHOICES.map((c) => [c.key, c]),
);

/** Visual grouping for the selection UI (order preserved). */
export const CHOICE_GROUPS: { group: "individual" | "business"; keys: string[] }[] = [
  { group: "individual", keys: ["end_consumer", "engineer_designer", "installer_technician", "contractor", "salesperson"] },
  { group: "business", keys: ["showroom_dealer", "supplier", "manufacturer_importer_wholesaler", "organization_owner_manager"] },
];
