/**
 * Who may CREATE a business, who may CONNECT to one, and who merely WORKS in one —
 * three different questions the workspace chrome used to answer with one control.
 *
 * Pure module (no server imports) so the rule is unit-testable and every surface
 * that offers "add a business" asks the same function.
 *
 *   1. SWITCHING where you work is a matter of real memberships: anyone who
 *      genuinely belongs to an organization may move between them. It confers no
 *      authority — every request still re-checks membership, capability, branch
 *      scope and RLS.
 *   2. CREATING a business is an ENTITLEMENT of the account type. It is approved
 *      only for the five types below. Holding a membership never grants it: an
 *      employee or a salesperson can work in a showroom without being offered a
 *      second one of their own.
 *   3. CONNECTING to a showroom is the Salesperson's affiliation path (their Sales
 *      tools live in someone else's business). It is decided by the existing Sales
 *      authority (`loadIsSalesPersona`), not here.
 *
 * Presentation-layer policy only. It changes which entry points are OFFERED; it
 * does not touch RLS, membership authority, or the database enums.
 */
import type { WorkspaceEntry } from "@/lib/workspace/model";

/** The personas approved to create a business activity. */
export const BUSINESS_CREATOR_PERSONAS = [
  "showroom_dealer",
  "supplier",
  "manufacturer",
  "importer",
  "engineer",
] as const;

/** Organization types whose OWNER is, by definition, one of the approved creators. */
const BUSINESS_CREATOR_ORG_TYPES: readonly string[] = ["showroom_dealer", "supplier", "manufacturer", "importer"];

/** A salesperson works inside someone else's business; never a creator. */
const NEVER_CREATORS: readonly string[] = ["sales", "installer_technician"];

export function canCreateBusiness(input: {
  /** `users.primary_account_type` (the persona), when known. */
  persona: string | null | undefined;
  /** The caller's derived workspaces (personal + active memberships). */
  entries: readonly WorkspaceEntry[];
}): boolean {
  const { persona, entries } = input;
  if (persona && NEVER_CREATORS.includes(persona)) return false;
  if (persona && (BUSINESS_CREATOR_PERSONAS as readonly string[]).includes(persona)) return true;
  // A business-only identity has no personal persona; what makes them a creator is
  // OWNING a business of an approved type — a mere member or manager does not.
  return entries.some(
    (e) =>
      e.kind === "business" &&
      e.relationship === "owner" &&
      e.orgType !== null &&
      BUSINESS_CREATOR_ORG_TYPES.includes(e.orgType),
  );
}

/**
 * The GENERIC workspace switcher (header crumb with the Personal row, every
 * organization and "Add business") exists only for the approved five categories
 * — the same set that may create a business. Holding a membership never puts it
 * on a header: a Salesperson, an employee or an ordinary personal account who
 * belongs to a showroom reaches that workplace through the narrower
 * `WorkplaceSwitcher` (inside /b2b) or the Sales affiliation route
 * (`/home/showroom`), never through this control.
 */
export function showsGenericWorkspaceSwitcher(input: {
  persona: string | null | undefined;
  entries: readonly WorkspaceEntry[];
}): boolean {
  return canCreateBusiness(input);
}

/**
 * Whether `/business/new` (and the draft writers behind it) may proceed. Two
 * independent conditions, either of which is enough:
 *
 *   A. `mayCompleteBusinessDraft` — the caller already has an OPEN business draft,
 *      or registered with a concrete business-type intent (track "business" and a
 *      business org_type). This is what keeps first-business registration
 *      working for someone who has no organization yet.
 *   B. `canCreateAdditionalBusiness` — the approved product entitlement
 *      (`canCreateBusiness`): the five categories, never a bare membership.
 */
export function decideBusinessCreation(input: {
  persona: string | null | undefined;
  entries: readonly WorkspaceEntry[];
  openDraftId: string | null;
  /** `onboarding_progress` says the person registered to create a business of this type. */
  registrationBusinessIntent: boolean;
}): { allowed: boolean; via: "draft" | "registration" | "entitlement" | null } {
  if (input.openDraftId) return { allowed: true, via: "draft" };
  if (input.registrationBusinessIntent) return { allowed: true, via: "registration" };
  if (canCreateBusiness(input)) return { allowed: true, via: "entitlement" };
  return { allowed: false, via: null };
}
