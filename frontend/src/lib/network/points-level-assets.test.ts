import { describe, expect, it } from "vitest";
import { POINTS_LEVEL_BADGE_ASSET } from "./points-level-assets";

describe("POINTS_LEVEL_BADGE_ASSET", () => {
  it("provides one stable project asset for every supported points level", () => {
    expect(POINTS_LEVEL_BADGE_ASSET).toEqual({
      1: "/assets/installer-points/level-1.png",
      2: "/assets/installer-points/level-2.png",
      3: "/assets/installer-points/level-3.png",
      4: "/assets/installer-points/level-4.png",
      5: "/assets/installer-points/level-5.png",
    });
  });
});
