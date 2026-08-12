/**
 * Derived profile completeness for a PERSONAL account.
 *
 * The score is computed on every read from the fields the persona's onboarding
 * actually collects — it is never a stored percentage, so it can never drift from
 * the profile. Only APPLICABLE items count: the denominator changes with the
 * persona (and, for the travel radius, with whether the professional works
 * on-site at all), so a remote-only designer is not permanently penalised for a
 * field that does not apply to them.
 *
 * Verification is deliberately NOT an item. Trust ("is this person verified?")
 * and completeness ("has this person filled in their profile?") are separate
 * signals and are surfaced separately — neither blocks account usage.
 *
 * Every key below maps to a field that already exists in `profiles`,
 * `onboarding_progress`, or `individual_onboarding`. No field is invented to
 * inflate the denominator.
 */

/** The profile/onboarding values the score is derived from. */
export type CompletenessInput = {
  displayName: string | null;
  phone: string | null;
  consumer: {
    intent: string | null;
    interests: string[];
    governorate: string | null;
    city: string | null;
    budget: string | null;
  };
  professional: {
    concreteType: string | null;
    headline: string | null;
    yearsExperience: number | null;
    specialization: string | null;
    bio: string | null;
    services: string[];
    languages: string[];
    availability: string | null;
    serviceAreas: string[];
    offersRemote: boolean;
    governorate: string | null;
    city: string | null;
    maxTravelKm: number | null;
  };
};

/**
 * Stable item keys. They are the i18n suffix under `personalHome.item.*` and the
 * identity of a "complete this next" action, so they must not be renamed lightly.
 */
export type CompletenessItemKey =
  | "displayName"
  | "phone"
  | "intent"
  | "interests"
  | "location"
  | "budget"
  | "professionalType"
  | "headline"
  | "experience"
  | "specialization"
  | "services"
  | "bio"
  | "languages"
  | "availability"
  | "serviceArea"
  | "travelRadius";

export type Completeness = {
  /** Rounded 0..100. 100 only when every applicable item is present. */
  percent: number;
  completed: number;
  total: number;
  /** Applicable items still missing, in display order. */
  missing: CompletenessItemKey[];
};

type Item = { key: CompletenessItemKey; done: boolean };

const filled = (v: string | null | undefined): boolean => Boolean(v && v.trim() !== "");

function score(items: Item[]): Completeness {
  const total = items.length;
  const completed = items.filter((i) => i.done).length;
  return {
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
    completed,
    total,
    missing: items.filter((i) => !i.done).map((i) => i.key),
  };
}

/** Consumer profile: the shared identity fields plus the consumer answers. */
export function consumerCompleteness(input: CompletenessInput): Completeness {
  const c = input.consumer;
  return score([
    { key: "displayName", done: filled(input.displayName) },
    { key: "phone", done: filled(input.phone) },
    { key: "intent", done: filled(c.intent) },
    { key: "interests", done: c.interests.length > 0 },
    { key: "location", done: filled(c.governorate) && filled(c.city) },
    { key: "budget", done: filled(c.budget) },
  ]);
}

/**
 * Professional profile: the shared identity fields plus the professional profile.
 * `serviceArea` is satisfied by either a service area or remote consultation —
 * the same rule the submit RPC enforces. `travelRadius` only applies to someone
 * who actually travels to a site.
 */
export function professionalCompleteness(input: CompletenessInput): Completeness {
  const p = input.professional;
  const worksOnSite = p.serviceAreas.length > 0;
  const items: Item[] = [
    { key: "displayName", done: filled(input.displayName) },
    { key: "phone", done: filled(input.phone) },
    { key: "professionalType", done: filled(p.concreteType) },
    { key: "headline", done: filled(p.headline) },
    { key: "experience", done: p.yearsExperience !== null },
    { key: "specialization", done: filled(p.specialization) },
    { key: "services", done: p.services.length > 0 },
    { key: "bio", done: filled(p.bio) },
    { key: "languages", done: p.languages.length > 0 },
    { key: "availability", done: filled(p.availability) },
    { key: "serviceArea", done: worksOnSite || p.offersRemote },
    { key: "location", done: filled(p.governorate) && filled(p.city) },
  ];
  if (worksOnSite) items.push({ key: "travelRadius", done: p.maxTravelKm !== null });
  return score(items);
}
