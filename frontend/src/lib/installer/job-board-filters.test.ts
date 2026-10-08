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
      q: " tiles ", trade: "tiling,painting", gov: "cairo", city: "maadi", applied: "no", min: "1000", max: "4500.5", duration: "medium", sort: "highest",
    });
    expect(filters).toMatchObject({ q: "tiles", tradeKeys: ["tiling", "painting"], governorate: "cairo", city: "maadi", applied: "no", minAmount: 1000, maxAmount: 4500.5, duration: "medium" });
    expect(sort).toBe("highest");
  });

  it("resolves a governorate NAME from an older link to its catalogue key", () => {
    expect(parseJobBoardParams({ gov: "Cairo" }).filters.governorate).toBe("cairo");
    expect(parseJobBoardParams({ gov: "القاهرة" }).filters.governorate).toBe("cairo");
    expect(parseJobBoardParams({ gov: "Atlantis" }).filters.governorate).toBe("");
  });

  it("only keeps a city that belongs to the chosen governorate", () => {
    expect(parseJobBoardParams({ gov: "cairo", city: "borg-el-arab" }).filters.city).toBe("");
    expect(parseJobBoardParams({ city: "maadi" }).filters.city).toBe("");
    expect(parseJobBoardParams({ gov: "alexandria", city: "borg-el-arab" }).filters.city).toBe("borg-el-arab");
  });

  it("'other' is the catalogue's own city key — no free text rides along, and an old `cityText` link is simply ignored", () => {
    const { filters } = parseJobBoardParams({ gov: "alexandria", city: "other", cityText: " Agami " } as never);
    expect(filters.city).toBe("other");
    expect(filters).not.toHaveProperty("cityOther");
    expect(toJobBoardSearch(filters, "newest")).not.toMatch(/cityText/);
  });

  it("carries no page position at all: the URL names the question, pages are appended", () => {
    expect(Object.keys(parseJobBoardParams({ shown: "999999" } as never))).toEqual(["filters", "sort"]);
    expect(toJobBoardSearch(DEFAULT_BOARD_FILTERS, "newest")).not.toMatch(/shown|offset|page/);
  });

  it("keeps the legacy single `trade=key` URL working", () => {
    expect(parseJobBoardParams({ trade: "tiling" }).filters.tradeKeys).toEqual(["tiling"]);
  });

  it("ignores junk instead of inventing a filter", () => {
    const { filters, sort } = parseJobBoardParams({ applied: "maybe", min: "abc", max: "-5", duration: "forever", sort: "random" });
    expect(filters.applied).toBe("");
    expect(filters.minAmount).toBeNull();
    expect(filters.maxAmount).toBeNull();
    expect(filters.duration).toBe("all");
    expect(sort).toBe("newest");
  });

  it("accepts nearest (a city/governorate tier) but never request-count sorting", () => {
    expect(parseJobBoardParams({ sort: "demanded" }).sort).toBe("newest");
    expect(parseJobBoardParams({ sort: "nearest" }).sort).toBe("nearest");
  });

  it("treats a zero minimum as a real bound", () => {
    expect(parseJobBoardParams({ min: "0" }).filters.minAmount).toBe(0);
  });

  it("reads a reversed range as the range it spans", () => {
    const { filters } = parseJobBoardParams({ min: "9000", max: "1000" });
    expect([filters.minAmount, filters.maxAmount]).toEqual([1000, 9000]);
  });

  it("round-trips through the URL", () => {
    const parsed = parseJobBoardParams({ q: "a", trade: "x,y", gov: "giza", city: "dokki", applied: "yes", min: "10", max: "20", duration: "long", sort: "nearest" });
    const again = parseJobBoardParams(Object.fromEntries(new URLSearchParams(toJobBoardSearch(parsed.filters, parsed.sort))));
    expect(again).toEqual(parsed);
  });

  it("builds the real query, omitting defaults", () => {
    expect(toOpportunityQuery(DEFAULT_BOARD_FILTERS, "newest")).toEqual({
      search: undefined, tradeKeys: undefined, governorateKey: undefined, cityKey: undefined, applied: undefined,
      minAmount: undefined, maxAmount: undefined, duration: undefined, sort: "newest",
    });
    const q = toOpportunityQuery({ ...DEFAULT_BOARD_FILTERS, tradeKeys: ["a"], minAmount: 0, maxAmount: 99.5, duration: "short" }, "highest");
    expect(q).toMatchObject({ tradeKeys: ["a"], minAmount: 0, maxAmount: 99.5, duration: "short", sort: "highest" });
  });

  it("sends the catalogue governorate and city as KEYS — every job stores the same keys, nothing is resolved from text", () => {
    const q = toOpportunityQuery({ ...DEFAULT_BOARD_FILTERS, governorate: "alexandria", city: "borg-el-arab" }, "newest");
    expect(q.governorateKey).toBe("alexandria");
    expect(q.cityKey).toBe("borg-el-arab");
    expect(q).not.toHaveProperty("cityText");
  });

  it("a city without a governorate is not a filter", () => {
    const q = toOpportunityQuery({ ...DEFAULT_BOARD_FILTERS, city: "maadi" }, "newest");
    expect(q.governorateKey).toBeUndefined();
    expect(q.cityKey).toBeUndefined();
  });

  it("'other city' is just another catalogue key to filter on", () => {
    const q = toOpportunityQuery({ ...DEFAULT_BOARD_FILTERS, governorate: "alexandria", city: "other" }, "newest");
    expect(q.governorateKey).toBe("alexandria");
    expect(q.cityKey).toBe("other");
  });

  it("nearest is a real database order now: the query asks for it, with every other filter intact", () => {
    expect(toOpportunityQuery(DEFAULT_BOARD_FILTERS, "nearest").sort).toBe("nearest");
    const q = toOpportunityQuery({ ...DEFAULT_BOARD_FILTERS, tradeKeys: ["painting"], governorate: "cairo", q: "villa" }, "nearest");
    expect(q).toMatchObject({ sort: "nearest", tradeKeys: ["painting"], governorateKey: "cairo", search: "villa" });
  });

  it("the canonical search of the default board is empty, and carries every active filter otherwise", () => {
    expect(toJobBoardSearch(DEFAULT_BOARD_FILTERS, "newest")).toBe("");
    expect(toJobBoardSearch({ ...DEFAULT_BOARD_FILTERS, q: "villa", saved: true }, "nearest")).toBe("q=villa&saved=1&sort=nearest");
  });
});
