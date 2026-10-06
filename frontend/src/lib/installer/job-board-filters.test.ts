import { describe, expect, it } from "vitest";
import { DEFAULT_BOARD_FILTERS } from "@/features/installer-job-opportunities-preview/view-model";
import { parseJobBoardParams, toJobBoardSearch, toOpportunityQuery } from "./job-board-filters";

describe("job board URL state", () => {
  it("defaults to ALL trades, no bounds, newest — nothing narrows the board", () => {
    const { filters, sort } = parseJobBoardParams({});
    expect(filters).toEqual(DEFAULT_BOARD_FILTERS);
    expect(filters.tradeKeys).toEqual([]);
    expect(sort).toBe("newest");
    expect(toJobBoardSearch(filters, sort)).toBe("");
  });

  it("parses every dimension", () => {
    const { filters, sort } = parseJobBoardParams({
      q: " tiles ", trade: "tiling,painting", gov: "Cairo", applied: "no", min: "1000", max: "4500.5", duration: "medium", sort: "highest",
    });
    expect(filters).toMatchObject({ q: "tiles", tradeKeys: ["tiling", "painting"], governorate: "Cairo", applied: "no", minAmount: 1000, maxAmount: 4500.5, duration: "medium" });
    expect(sort).toBe("highest");
  });

  it("keeps the legacy single `trade=key` URL working", () => {
    expect(parseJobBoardParams({ trade: "tiling" }).filters.tradeKeys).toEqual(["tiling"]);
  });

  it("ignores junk instead of inventing a filter", () => {
    const { filters, sort } = parseJobBoardParams({ applied: "maybe", min: "abc", max: "-5", duration: "forever", sort: "nearest" });
    expect(filters.applied).toBe("");
    expect(filters.minAmount).toBeNull();
    expect(filters.maxAmount).toBeNull();
    expect(filters.duration).toBe("all");
    expect(sort).toBe("newest");
  });

  it("never offers distance or request-count sorting", () => {
    expect(parseJobBoardParams({ sort: "demanded" }).sort).toBe("newest");
    expect(parseJobBoardParams({ sort: "nearest" }).sort).toBe("newest");
  });

  it("treats a zero minimum as a real bound", () => {
    expect(parseJobBoardParams({ min: "0" }).filters.minAmount).toBe(0);
  });

  it("reads a reversed range as the range it spans", () => {
    const { filters } = parseJobBoardParams({ min: "9000", max: "1000" });
    expect([filters.minAmount, filters.maxAmount]).toEqual([1000, 9000]);
  });

  it("round-trips through the URL", () => {
    const parsed = parseJobBoardParams({ q: "a", trade: "x,y", gov: "Giza", applied: "yes", min: "10", max: "20", duration: "long", sort: "highest" });
    const again = parseJobBoardParams(Object.fromEntries(new URLSearchParams(toJobBoardSearch(parsed.filters, parsed.sort))));
    expect(again).toEqual(parsed);
  });

  it("builds the real query, omitting defaults", () => {
    expect(toOpportunityQuery(DEFAULT_BOARD_FILTERS, "newest")).toEqual({
      search: undefined, tradeKeys: undefined, governorate: undefined, applied: undefined,
      minAmount: undefined, maxAmount: undefined, duration: undefined, sort: "newest",
    });
    const q = toOpportunityQuery({ ...DEFAULT_BOARD_FILTERS, tradeKeys: ["a"], minAmount: 0, maxAmount: 99.5, duration: "short" }, "highest");
    expect(q).toMatchObject({ tradeKeys: ["a"], minAmount: 0, maxAmount: 99.5, duration: "short", sort: "highest" });
  });
});
