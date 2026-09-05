export type PointsLevel = 1 | 2 | 3 | 4 | 5;

/** `LEVEL_THRESHOLDS[i]` is the balance at which level `i + 1` begins. */
const LEVEL_THRESHOLDS: readonly number[] = [0, 100, 250, 500, 1000];

export type PointsLevelInfo = {
  level: PointsLevel;
  isMaxLevel: boolean;
  /** Points still needed for the next level. `null` exactly at the max level. */
  remainingToNextLevel: number | null;
  /** 0–100, this level's share of its own band. 100 at the max level. */
  progressPct: number;
};

/**
 * Derives a presentation-only "level" band from the real Points balance.
 *
 * NOT STORED, NOT AUTHORITATIVE, GATES NOTHING — this is a pure, always
 * re-derived read of the one real number (`points_balance`), never written
 * anywhere. `docs/database/points-core.md` refuses a persisted tier/level in
 * the ledger itself ("no achievement or level model of any kind"); this is
 * the separate, approved PRESENTATION rule layered on top of that real
 * balance for the Network Points card — see "Presentation-level bands" in
 * that document. It cannot drift from the ledger because it reads nothing
 * else and stores nothing back.
 *
 * A negative balance (possible after a correction, D2) still resolves to
 * Level 1 rather than a negative or fractional level — the bands describe
 * how far a non-negative standing has climbed, not the correction itself.
 */
export function derivePointsLevel(balance: number): PointsLevelInfo {
  const b = Math.max(0, balance);

  let level: PointsLevel = 1;
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i -= 1) {
    if (b >= LEVEL_THRESHOLDS[i]!) {
      level = (i + 1) as PointsLevel;
      break;
    }
  }

  const isMaxLevel = level === 5;
  const currentThreshold = LEVEL_THRESHOLDS[level - 1] as number;
  const nextThreshold = isMaxLevel ? null : (LEVEL_THRESHOLDS[level] as number);
  const remainingToNextLevel = nextThreshold === null ? null : nextThreshold - b;
  const progressPct = isMaxLevel || nextThreshold === null
    ? 100
    : Math.min(100, Math.max(0, ((b - currentThreshold) / (nextThreshold - currentThreshold)) * 100));

  return { level, isMaxLevel, remainingToNextLevel, progressPct };
}
