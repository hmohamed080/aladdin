import { describe, expect, it } from "vitest";
import { hasDateFilter, overlapsPlannedWindow } from "./planned-window";

const june = { from: "2025-06-01", to: "2025-06-30" };
const none = { from: "", to: "" };

describe("overlapsPlannedWindow", () => {
  it("includes everything, even a record with no dates, when no filter is selected", () => {
    expect(hasDateFilter(none)).toBe(false);
    expect(overlapsPlannedWindow({ startsOn: null, endsBy: null }, none)).toBe(true);
  });

  it("start + end: includes any overlap, not only containment", () => {
    expect(overlapsPlannedWindow({ startsOn: "2025-05-20", endsBy: "2025-06-05" }, june)).toBe(true);
    expect(overlapsPlannedWindow({ startsOn: "2025-06-25", endsBy: "2025-07-10" }, june)).toBe(true);
    expect(overlapsPlannedWindow({ startsOn: "2025-05-01", endsBy: "2025-07-31" }, june)).toBe(true);
    expect(overlapsPlannedWindow({ startsOn: "2025-06-10", endsBy: "2025-06-12" }, june)).toBe(true);
  });

  it("start + end: excludes a window wholly before or after the range", () => {
    expect(overlapsPlannedWindow({ startsOn: "2025-05-01", endsBy: "2025-05-31" }, june)).toBe(false);
    expect(overlapsPlannedWindow({ startsOn: "2025-07-01", endsBy: "2025-07-09" }, june)).toBe(false);
  });

  it("treats the range bounds as inclusive", () => {
    expect(overlapsPlannedWindow({ startsOn: "2025-05-01", endsBy: "2025-06-01" }, june)).toBe(true);
    expect(overlapsPlannedWindow({ startsOn: "2025-06-30", endsBy: "2025-07-02" }, june)).toBe(true);
  });

  it("start only: compares the known start", () => {
    expect(overlapsPlannedWindow({ startsOn: "2025-06-15", endsBy: null }, june)).toBe(true);
    expect(overlapsPlannedWindow({ startsOn: "2025-07-15", endsBy: null }, june)).toBe(false);
  });

  it("end only: compares the known end", () => {
    expect(overlapsPlannedWindow({ startsOn: null, endsBy: "2025-06-20" }, june)).toBe(true);
    expect(overlapsPlannedWindow({ startsOn: null, endsBy: "2025-05-20" }, june)).toBe(false);
  });

  it("no dates at all is excluded once a date filter is active", () => {
    expect(overlapsPlannedWindow({ startsOn: null, endsBy: null }, june)).toBe(false);
    expect(overlapsPlannedWindow({ startsOn: null, endsBy: null }, { from: "2025-06-01", to: "" })).toBe(false);
  });

  it("supports an open-ended range", () => {
    expect(overlapsPlannedWindow({ startsOn: "2025-08-01", endsBy: "2025-08-05" }, { from: "2025-06-01", to: "" })).toBe(true);
    expect(overlapsPlannedWindow({ startsOn: "2025-04-01", endsBy: "2025-04-05" }, { from: "2025-06-01", to: "" })).toBe(false);
    expect(overlapsPlannedWindow({ startsOn: "2025-04-01", endsBy: "2025-04-05" }, { from: "", to: "2025-06-30" })).toBe(true);
    expect(overlapsPlannedWindow({ startsOn: "2025-08-01", endsBy: "2025-08-05" }, { from: "", to: "2025-06-30" })).toBe(false);
  });

  it("accepts timestamps by comparing only the date part", () => {
    expect(overlapsPlannedWindow({ startsOn: null, endsBy: "2025-06-20T23:59:00Z" }, june)).toBe(true);
  });
});
