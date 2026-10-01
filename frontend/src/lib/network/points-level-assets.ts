import type { PointsLevel } from "./points-level";

/** Stable asset paths for the five presentation-only points bands. */
export const POINTS_LEVEL_BADGE_ASSET: Readonly<Record<PointsLevel, string>> = {
  1: "/assets/installer-points/level-1.png",
  2: "/assets/installer-points/level-2.png",
  3: "/assets/installer-points/level-3.png",
  4: "/assets/installer-points/level-4.png",
  5: "/assets/installer-points/level-5.png",
};
