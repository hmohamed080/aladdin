import { describe, expect, it } from "vitest";
import {
  MATCH_MAX,
  matchLevel,
  matchLevelLabel,
  matchLines,
  toMatchBreakdown,
  type AvailabilityReason,
  type LocationReason,
  type MatchBreakdown,
  type SpecialtyReason,
  type TradeReason,
} from "./overall-match";

/**
 * The frontend side of the Overall Match: it NAMES a level and WORDS a reason; it never computes a score. The score and
 * every component are the database's (supabase/tests/74_overall_match_test.sql); these tests pin the presentation.
 */

const base: MatchBreakdown = {
  overallPercent: 100, tradePoints: 50, specialtyPoints: 20, locationPoints: 15, availabilityPoints: 15,
  tradeReason: "trade_matches", specialtyReason: "no_specialty_required", locationReason: "same_city", availabilityReason: "available_no_dates",
};

describe("the approved weights", () => {
  it("are 50 / 20 / 15 / 15 and sum to 100", () => {
    expect(MATCH_MAX).toEqual({ trade: 50, specialty: 20, location: 15, availability: 15 });
    expect(Object.values(MATCH_MAX).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("matchLevel — the five approved ranges", () => {
  it.each([
    [100, "excellent"], [90, "excellent"],
    [89, "strong"], [75, "strong"],
    [74, "good"], [60, "good"],
    [59, "partial"], [40, "partial"],
    [39, "low"], [0, "low"],
  ] as const)("%i is %s", (percent, level) => {
    expect(matchLevel(percent)).toBe(level);
  });

  it("is named in both languages exactly as approved", () => {
    expect([100, 80, 65, 50, 10].map((p) => matchLevelLabel(p, "ar"))).toEqual(["توافق ممتاز", "توافق قوي", "توافق جيد", "توافق جزئي", "توافق ضعيف"]);
    expect([100, 80, 65, 50, 10].map((p) => matchLevelLabel(p, "en"))).toEqual(["Excellent match", "Strong match", "Good match", "Partial match", "Low match"]);
  });
});

describe("toMatchBreakdown — the database's columns, unchanged", () => {
  it("maps every column and recomputes nothing", () => {
    const m = toMatchBreakdown({
      overall_percent: 61, trade_points: 50, specialty_points: 0, location_points: 10, availability_points: 1,
      trade_reason: "trade_matches", specialty_reason: "specialty_missing", location_reason: "primary_governorate", availability_reason: "window_covers",
    });
    // the "1" availability is nonsense on purpose: the presentation layer must pass it through, not "fix" it
    expect(m).toEqual({ overallPercent: 61, tradePoints: 50, specialtyPoints: 0, locationPoints: 10, availabilityPoints: 1, tradeReason: "trade_matches", specialtyReason: "specialty_missing", locationReason: "primary_governorate", availabilityReason: "window_covers" });
  });
});

describe("matchLines — every stable reason code has words in both languages", () => {
  const trade: TradeReason[] = ["trade_matches", "trade_mismatch", "no_declared_trade"];
  const specialty: SpecialtyReason[] = ["specialty_matches", "specialty_missing", "no_specialty_required", "trade_mismatch"];
  const location: LocationReason[] = ["same_city", "primary_governorate", "other_service_area", "outside_service_area", "no_service_area", "job_location_unknown"];
  const availability: AvailabilityReason[] = ["availability_not_declared", "not_available_for_work", "available_no_dates", "window_covers", "window_not_covering", "no_window_declared"];

  it.each(["ar", "en"] as const)("%s: no code falls through to a raw key or an empty sentence", (locale) => {
    for (const tradeReason of trade) for (const specialtyReason of specialty) for (const locationReason of location) for (const availabilityReason of availability) {
      const lines = matchLines({ ...base, tradeReason, specialtyReason, locationReason, availabilityReason }, locale);
      expect(lines.map((l) => l.key)).toEqual(["trade", "specialty", "location", "availability"]);
      for (const line of lines) {
        expect(line.text.length).toBeGreaterThan(3);
        expect(line.text).not.toMatch(/_/); // never a raw reason code
        expect(line.title.length).toBeGreaterThan(1);
      }
    }
  });

  it("carries the database's own points and the stable code on every line, and 'met' means anything earned", () => {
    const lines = matchLines({ ...base, overallPercent: 70, specialtyPoints: 0, specialtyReason: "specialty_missing", locationPoints: 5, locationReason: "other_service_area", availabilityPoints: 0, availabilityReason: "window_not_covering" }, "en");
    expect(lines.map((l) => [l.key, l.points, l.max, l.met, l.reason])).toEqual([
      ["trade", 50, 50, true, "trade_matches"],
      ["specialty", 0, 20, false, "specialty_missing"],
      ["location", 5, 15, true, "other_service_area"], // a partial location is still met
      ["availability", 0, 15, false, "window_not_covering"],
    ]);
  });

  it("NOT DECLARED availability is 'Not specified' — null points, not a 0, not a miss, never worded as unavailable", () => {
    const m = toMatchBreakdown({
      overall_percent: 85, trade_points: 50, specialty_points: 20, location_points: 15, availability_points: null,
      trade_reason: "trade_matches", specialty_reason: "no_specialty_required", location_reason: "same_city", availability_reason: "availability_not_declared",
    });
    expect(m.availabilityPoints).toBeNull();
    const [, , , availability] = matchLines(m, "en");
    expect(availability).toMatchObject({ key: "availability", points: null, met: false, notSpecified: true, reason: "availability_not_declared" });
    expect(availability!.text).toMatch(/haven't said whether you're available/);
    expect(availability!.text).not.toMatch(/not taking work|unavailable/i);
    expect(matchLines(m, "ar")[3]!.text).toMatch(/لم تحدد توفرك/);
    // every OTHER line is an ordinary number
    expect(matchLines(m, "en").slice(0, 3).every((l) => l.points !== null && !l.notSpecified)).toBe(true);
  });

  it("an explicitly UNAVAILABLE caller is a real 0 with its own wording", () => {
    const [, , , a] = matchLines({ ...base, availabilityPoints: 0, availabilityReason: "not_available_for_work" }, "en");
    expect(a).toMatchObject({ points: 0, met: false, notSpecified: false });
    expect(a!.text).toMatch(/not taking work/);
  });

  it("an unknown future code degrades to a plain sentence, never to a crash or a raw key", () => {
    const lines = matchLines({ ...base, locationReason: "brand_new_code" as never }, "en");
    expect(lines[2]!.text).not.toMatch(/brand_new_code/);
  });

  it("states the reasons in the approved words", () => {
    const en = Object.fromEntries(matchLines({ ...base, specialtyReason: "specialty_matches", availabilityPoints: 0, availabilityReason: "window_not_covering" }, "en").map((l) => [l.key, l.text]));
    expect(en).toMatchObject({ trade: "Trade matches", specialty: "Specialty requirement matches", location: "In your city", availability: "Your availability doesn't cover the job period" });
    const ar = Object.fromEntries(matchLines({ ...base, specialtyReason: "specialty_matches" }, "ar").map((l) => [l.key, l.text]));
    expect(ar).toMatchObject({ trade: "الحرفة مناسبة", specialty: "التخصص المطلوب مناسب", location: "في مدينتك" });
  });
});
