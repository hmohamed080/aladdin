import type { TranslateFn } from "./translate";

/**
 * The two ways this product names what a professional does, and one function for
 * each — because they are different KINDS of value and only one of them is now
 * authority.
 *
 * `tradeLabel` reads a canonical `trades.key`. `specializationLabel` reads the
 * legacy free-text `individual_onboarding.prof_specialization`, which is a
 * vocabulary key in some rows and a sentence in others.
 */

/**
 * The display name for a canonical trade key.
 *
 * WHY THE NAMESPACE IS THE ONBOARDING ONE. §4.2 of the Installer spec is
 * explicit: trade names are NOT database columns, they live in these catalogs
 * keyed by `trades.key`, "exactly as the shipped code already does". Five of the
 * seven seeded keys ARE the onboarding specialization chips, so giving trades
 * their own namespace would duplicate five strings and create precisely the
 * second translation source the spec forbids a `name_ar` column for.
 *
 * That makes the namespace inherited debt rather than a home, which is the whole
 * reason this function exists instead of the lookup being inlined at five call
 * sites: when `prof_specialization` is finally retired, its catalog moves, and
 * this is the one line that has to know.
 *
 * An unknown key returns the KEY, never a message path. A path on a public
 * profile ("onboarding.professional.specializations.tiling") tells a visitor
 * nothing except that something is broken, and they cannot tell whose fault it
 * is — the same failure `languageLabel` was written to stop.
 */
export function tradeLabel(t: TranslateFn, key: string): string {
  const messageKey = `onboarding.professional.specializations.${key}`;
  const label = t(messageKey);
  return label === messageKey ? key : label;
}

/**
 * The legacy free-text specialization, rendered without ever printing a key path.
 *
 * `individual_onboarding.prof_specialization` is `text` with an 80-character
 * check, and it genuinely holds two conventions:
 *
 *   * a stable vocabulary key (`gypsum_paint`) where the onboarding chips or the
 *     profile editor wrote it;
 *   * free prose ("Marble and granite fixing") in every seeded and staging
 *     professional, and in anything imported.
 *
 * Passing the second kind through the catalog renders
 * `onboarding.professional.specializations.Marble and granite fixing` verbatim —
 * on a PUBLIC page, to a stranger. So a value that resolves is a key and is
 * translated; a value that does not is prose and is shown as written.
 *
 * This function does NOT try to turn prose into a trade. Nothing does: the
 * canonical taxonomy is populated by explicit selection or by an explicit,
 * hand-written mapping in seed data. Guessing that "Plumbing and sanitary
 * fitting" means `plumbing` is right until the day it is "Plumbing and gypsum",
 * and a wrong guess publishes a claim the professional never made.
 */
export function specializationLabel(t: TranslateFn, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const messageKey = `onboarding.professional.specializations.${trimmed}`;
  const label = t(messageKey);
  return label === messageKey ? trimmed : label;
}
