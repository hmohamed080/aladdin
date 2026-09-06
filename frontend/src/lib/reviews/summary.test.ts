import { describe, expect, it } from "vitest";
import { distributionRows, starFill, summarizeReviews } from "./summary";

/**
 * The one derivation every review number in the product comes from (§9).
 *
 * These assertions matter more than most, because three surfaces show the same
 * average — the Reviews page, the profile hub and the public profile — and each
 * of them shows it beside the list it was computed from. A bug here is a product
 * that contradicts itself in front of the person being rated.
 */
describe("summarizeReviews", () => {
  it("counts every star into its own bucket, and always returns all five", () => {
    const s = summarizeReviews([{ rating: 5 }, { rating: 5 }, { rating: 3 }]);
    expect(s.distribution).toEqual({ 1: 0, 2: 0, 3: 1, 4: 0, 5: 2 });
    expect(s.total).toBe(3);
  });

  it("averages to one decimal", () => {
    expect(summarizeReviews([{ rating: 5 }, { rating: 4 }]).average).toBe(4.5);
    expect(summarizeReviews([{ rating: 5 }, { rating: 4 }, { rating: 4 }]).average).toBe(4.3);
  });

  /**
   * §9 by name. Zero is a score somebody could conceivably be given; "no reviews
   * yet" is not a bad one. A fresh professional shown `0.0` beside five empty
   * stars would be the product delivering a verdict nobody delivered.
   */
  it("returns NULL for an empty set rather than zero", () => {
    const s = summarizeReviews([]);
    expect(s.average).toBeNull();
    expect(s.total).toBe(0);
    expect(s.distribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  });

  it("keeps a single review honest — one 5 is 5.0 out of one, not a record", () => {
    const s = summarizeReviews([{ rating: 5 }]);
    expect(s.average).toBe(5);
    expect(s.total).toBe(1);
  });

  /**
   * The table refuses anything outside 1–5, so a value here did not come from
   * this domain. Skipping keeps it out of a number a person is judged by, rather
   * than letting it move one.
   */
  it("ignores a rating the database could not have produced", () => {
    const s = summarizeReviews([{ rating: 5 }, { rating: 0 }, { rating: 6 }, { rating: 4.5 }]);
    expect(s.total).toBe(1);
    expect(s.average).toBe(5);
  });

  it("is a pure function of its input — the same array always gives the same answer", () => {
    const rows = [{ rating: 4 }, { rating: 2 }];
    expect(summarizeReviews(rows)).toEqual(summarizeReviews(rows));
  });
});

describe("distributionRows", () => {
  it("orders five to one, as the reference shows them", () => {
    const rows = distributionRows(summarizeReviews([{ rating: 1 }, { rating: 5 }]));
    expect(rows.map((r) => r.stars)).toEqual([5, 4, 3, 2, 1]);
  });

  it("computes each percentage against the total", () => {
    const rows = distributionRows(
      summarizeReviews([{ rating: 5 }, { rating: 5 }, { rating: 5 }, { rating: 4 }]),
    );
    expect(rows.find((r) => r.stars === 5)).toEqual({ stars: 5, count: 3, percent: 75 });
    expect(rows.find((r) => r.stars === 4)).toEqual({ stars: 4, count: 1, percent: 25 });
  });

  it("does not divide by zero on an empty set", () => {
    const rows = distributionRows(summarizeReviews([]));
    expect(rows.every((r) => r.percent === 0 && r.count === 0)).toBe(true);
  });

  /** The count is carried beside the percent because 100% of one is not a record. */
  it("carries the raw count as well as the percentage", () => {
    const rows = distributionRows(summarizeReviews([{ rating: 5 }]));
    expect(rows.find((r) => r.stars === 5)).toEqual({ stars: 5, count: 1, percent: 100 });
  });
});

describe("starFill", () => {
  it("rounds to the nearest half, so 4.4 and 4.6 do not both become the same shape", () => {
    expect(starFill(4.4)).toBe(4.5);
    expect(starFill(4.6)).toBe(4.5);
    expect(starFill(4.8)).toBe(5);
    expect(starFill(4.2)).toBe(4);
  });

  it("leaves a whole number alone", () => {
    expect(starFill(5)).toBe(5);
    expect(starFill(1)).toBe(1);
  });
});
