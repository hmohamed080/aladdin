export type LandingStats = { users: number | null; organizations: number | null; products: number | null };

/** Exact below 1,000; floored to hundreds below 10,000 ("+4,800"); otherwise floored to thousands ("+250 ألف"). A shown number is never higher than the truth. */
export function formatStat(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10_000) return `+${(Math.floor(n / 100) * 100).toLocaleString("en-US")}`;
  return `+${Math.floor(n / 1000)} ألف`;
}
