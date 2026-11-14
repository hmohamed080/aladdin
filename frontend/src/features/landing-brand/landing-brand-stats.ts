export type LandingStats = { users: number | null; organizations: number | null; products: number | null };

/** Exact below 1,000, otherwise the count floored to thousands ("+250 ألف"), so a shown number is never higher than the truth. */
export function formatStat(n: number): string {
  if (n < 1000) return `${n}`;
  return `+${Math.floor(n / 1000)} ألف`;
}
