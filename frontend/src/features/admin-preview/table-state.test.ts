import { describe, expect, it } from "vitest";
import {
  canonicalRoute,
  clampPageSize,
  nextSort,
  pageItems,
  paginate,
  parseSort,
  previewRegisteredAt,
  sortRows,
} from "./table-state";

describe("clampPageSize", () => {
  it("accepts only the approved sizes and defaults to 10", () => {
    expect(clampPageSize("25")).toBe(25);
    expect(clampPageSize(100)).toBe(100);
    expect(clampPageSize("7")).toBe(10);
    expect(clampPageSize(undefined)).toBe(10);
  });
});

describe("paginate", () => {
  const rows = Array.from({ length: 23 }, (_, i) => i + 1);
  it("slices and reports the shown range", () => {
    const s = paginate(rows, 3, 10);
    expect(s.rows).toEqual([21, 22, 23]);
    expect([s.from, s.to, s.total, s.totalPages]).toEqual([21, 23, 23, 3]);
  });
  it("clamps an out-of-range page", () => {
    expect(paginate(rows, 99, 10).page).toBe(3);
    expect(paginate(rows, "x", 10).page).toBe(1);
  });
  it("reports an empty list as 0–0 of 0 on page 1", () => {
    const s = paginate([], 1, 10);
    expect([s.from, s.to, s.total, s.page, s.totalPages]).toEqual([0, 0, 0, 1, 1]);
  });
});

describe("pageItems", () => {
  it("lists every page when there are few", () => {
    expect(pageItems(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });
  it("keeps first, last and a window around the current page", () => {
    expect(pageItems(1, 20)).toEqual([1, 2, "gap", 20]);
    expect(pageItems(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
    expect(pageItems(20, 20)).toEqual([1, "gap", 19, 20]);
  });
  it("never hides a single page behind a gap", () => {
    expect(pageItems(4, 20)).toEqual([1, 2, 3, 4, 5, "gap", 20]);
  });
});

describe("sorting — Registered and Profile Completion stay independent", () => {
  type Row = { id: string; registered: number; completeness: number };
  const rows: Row[] = [
    { id: "a", registered: 3, completeness: 40 },
    { id: "b", registered: 1, completeness: 90 },
    { id: "c", registered: 2, completeness: 60 },
  ];

  it("parses only declared fields", () => {
    expect(parseSort("registered:asc", ["registered", "completeness"])).toEqual({ field: "registered", dir: "asc" });
    expect(parseSort("unknown:asc", ["registered", "completeness"])).toBeNull();
    expect(parseSort(null, ["registered"])).toBeNull();
  });

  it("clicking a new column starts at its own natural direction, never the old column's", () => {
    expect(nextSort({ field: "completeness", dir: "asc" }, "registered")).toBe("registered:desc");
    expect(nextSort({ field: "registered", dir: "desc" }, "registered")).toBe("registered:asc");
    expect(nextSort(null, "completeness")).toBe("completeness:desc");
  });

  it("sorts by exactly the requested accessor", () => {
    const byReg = sortRows(rows, "desc", (r) => r.registered, (r) => r.id).map((r) => r.id);
    const byComp = sortRows(rows, "desc", (r) => r.completeness, (r) => r.id).map((r) => r.id);
    expect(byReg).toEqual(["a", "c", "b"]);
    expect(byComp).toEqual(["b", "c", "a"]);
    expect(sortRows(rows, "asc", (r) => r.registered, (r) => r.id).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("breaks ties deterministically by id", () => {
    const tied = [
      { id: "z", v: 1 },
      { id: "m", v: 1 },
    ];
    expect(sortRows(tied, "desc", (r) => r.v, (r) => r.id).map((r) => r.id)).toEqual(["m", "z"]);
  });
});

describe("previewRegisteredAt", () => {
  it("is deterministic and never later than the real date", () => {
    const real = "2026-09-28T10:00:00.000Z";
    const a = previewRegisteredAt("user-1", real);
    expect(previewRegisteredAt("user-1", real)).toBe(a);
    expect(new Date(a).getTime()).toBeLessThanOrEqual(new Date(real).getTime());
    expect(new Date(real).getTime() - new Date(a).getTime()).toBeLessThan(30 * 86_400_000);
  });
});

describe("canonicalRoute", () => {
  it("groups entity ids into route patterns", () => {
    expect(canonicalRoute("/p/9c1e8f2a-1b2c-4d3e-8f90-123456789abc")).toBe("/p/[id]");
    expect(canonicalRoute("/home/jobs/123")).toBe("/home/jobs/[id]");
    expect(canonicalRoute("/profile/456?ref=x")).toBe("/profile/[id]");
    expect(canonicalRoute("/home/network/")).toBe("/home/network");
    expect(canonicalRoute("/")).toBe("/");
  });
});
