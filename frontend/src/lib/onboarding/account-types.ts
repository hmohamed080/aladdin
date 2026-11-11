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
import { REGISTERABLE_BUSINESS_ORG_TYPES, REGISTRATION_ORDER } from "@/lib/taxonomy/accounts";

export type OnboardingTrack = "consumer" | "professional" | "business";

/** Personal personas a person may claim at registration. */
export type PersonalPersona =
  | "end_consumer"
  | "engineer"
  | "installer_technician"
  | "contractor"
  | "sales";

export type AccountTypeChoice = {
  /** Stable key used as the form value + i18n key suffix. */
  key: string;
  track: OnboardingTrack;
  /** Concrete DB account_type — a persona (personal) or an org_type (business). */
  accountType: PersonalPersona | BusinessOrgType | null;
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
 * These are supported by the canonical organization enum and onboarding RPCs.
 * Public registration choices remain separate below. (An individual Contractor is a
 * PERSONAL persona, not a business type; there is no contractor `org_type`, so
 * none is offered here.)
 */
/**
 * The business `org_type` values a new registration may create: the four public
 * businesses plus `design_office`, the business behind the Engineer account.
 * `wholesaler` is a Supplier SUBTYPE (`public.activities`), not an organization
 * type, and `contractor_company` is the internal business behind the Contractor
 * account, never a registration choice. Read from the canonical taxonomy.
 */
export const BUSINESS_ORG_TYPES = REGISTERABLE_BUSINESS_ORG_TYPES;
export type BusinessOrgType = (typeof BUSINESS_ORG_TYPES)[number];

export function isBusinessOrgType(value: string | null | undefined): value is BusinessOrgType {
  return !!value && (BUSINESS_ORG_TYPES as readonly string[]).includes(value);
}

/**
 * The org_types an ORGANIZATION APPLICATION may name: the registerable businesses plus
 * `contractor_company`, which is reached ONLY through an application by a Contractor (it is
 * the Contractor's organization operating model, never a registration choice or a tenth
 * account). The database is the authority; this list is the shape check and the UI source.
 */
export const APPLICATION_ORG_TYPES = [...BUSINESS_ORG_TYPES, "contractor_company"] as const;
export type ApplicationOrgType = (typeof APPLICATION_ORG_TYPES)[number];

export function applicationOrgTypeFrom(value: string | null | undefined): ApplicationOrgType | null {
  return !!value && (APPLICATION_ORG_TYPES as readonly string[]).includes(value)
    ? (value as ApplicationOrgType)
    : null;
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
  { key: "organization_owner_manager", track: "business", accountType: null, transitional: true },
];

export const CHOICES_BY_KEY: Record<string, AccountTypeChoice> = Object.fromEntries(
  ACCOUNT_TYPE_CHOICES.map((c) => [c.key, c]),
);

/**
 * Shared order for the landing-page account menu and the sign-up select.
 * Keep the canonical order within each availability group, but show every
 * currently selectable type before all Coming Soon types. Never modify the
 * canonical PUBLIC_ACCOUNTS order or the server-side eligibility rules here.
 */
export const REGISTRATION_CHOICE_ORDER: string[] = [
  ...REGISTRATION_ORDER.filter((key) => CHOICES_BY_KEY[key]?.comingSoon !== true),
  ...REGISTRATION_ORDER.filter((key) => CHOICES_BY_KEY[key]?.comingSoon === true),
];

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
  { group: "business", keys: ["showroom_dealer", "supplier", "manufacturer", "importer"] },
];
