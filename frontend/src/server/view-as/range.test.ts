import { describe, expect, it } from "vitest";
import { contentRangeMatches, parseContentRange, parseRangeHeader, unsatisfiedContentRange, upstreamRange } from "./range";

describe("parseRangeHeader", () => {
  it("no header is no range", () => expect(parseRangeHeader(null)).toEqual({ kind: "none" }));
  it("a closed range", () => expect(parseRangeHeader("bytes=0-99")).toEqual({ kind: "from", start: 0, end: 99 }));
  it("an open-ended range", () => expect(parseRangeHeader("bytes=1000-")).toEqual({ kind: "from", start: 1000, end: null }));
  it("a suffix range", () => expect(parseRangeHeader("bytes=-500")).toEqual({ kind: "suffix", length: 500 }));
  it("a single byte", () => expect(parseRangeHeader("bytes=5-5")).toEqual({ kind: "from", start: 5, end: 5 }));
  it.each([
    ["multi-range", "bytes=0-1,5-9"],
    ["multi-range with spaces", "bytes=0-1, 5-9"],
    ["another unit", "items=0-5"],
    ["no dash", "bytes=5"],
    ["empty spec", "bytes=-"],
    ["empty value", "bytes="],
    ["a zero suffix", "bytes=-0"],
    ["inverted", "bytes=9-3"],
    ["a negative start", "bytes=-5-9"],
    ["letters", "bytes=a-b"],
    ["a float", "bytes=1.5-9"],
    ["a unit-less value", "0-9"],
    ["too many digits (unsafe integer)", "bytes=0-99999999999999999999"],
    ["a huge start", "bytes=9007199254740993-"],
    ["an empty string", ""],
  ])("rejects %s", (_n, v) => expect(parseRangeHeader(v)).toBe("invalid"));
});

describe("upstreamRange (clamped to the per-response cap)", () => {
  const cap = 1000;
  it("clamps an open-ended range", () => expect(upstreamRange({ kind: "from", start: 10, end: null }, cap)).toBe("bytes=10-1009"));
  it("clamps a long closed range", () => expect(upstreamRange({ kind: "from", start: 0, end: 99999 }, cap)).toBe("bytes=0-999"));
  it("keeps a short closed range", () => expect(upstreamRange({ kind: "from", start: 5, end: 9 }, cap)).toBe("bytes=5-9"));
  it("clamps a suffix", () => expect(upstreamRange({ kind: "suffix", length: 5000 }, cap)).toBe("bytes=-1000"));
});

describe("upstream Content-Range validation", () => {
  it("parses a valid one and rejects junk", () => {
    expect(parseContentRange("bytes 0-9/100")).toEqual({ start: 0, end: 9, total: 100 });
    for (const v of [null, "bytes 0-9/*", "bytes */100", "bytes 9-0/100", "bytes 0-100/100", "items 0-9/100", "bytes 0-9/100, bytes 1-2/100"]) {
      expect(parseContentRange(v)).toBeNull();
    }
  });
  it("accepts only an answer that matches the request and the cap", () => {
    const from = { kind: "from", start: 10, end: 19 } as const;
    expect(contentRangeMatches({ start: 10, end: 19, total: 100 }, from, 1000)).toBe(true);
    expect(contentRangeMatches({ start: 10, end: 12, total: 100 }, from, 1000)).toBe(true);        // shorter is fine
    expect(contentRangeMatches({ start: 0, end: 19, total: 100 }, from, 1000)).toBe(false);        // wrong start
    expect(contentRangeMatches({ start: 10, end: 50, total: 100 }, from, 1000)).toBe(false);       // beyond the request
    expect(contentRangeMatches({ start: 10, end: 19, total: 100 }, from, 5)).toBe(false);          // beyond the cap
    const suffix = { kind: "suffix", length: 20 } as const;
    expect(contentRangeMatches({ start: 80, end: 99, total: 100 }, suffix, 1000)).toBe(true);
    expect(contentRangeMatches({ start: 70, end: 99, total: 100 }, suffix, 1000)).toBe(false);
    expect(contentRangeMatches({ start: 80, end: 98, total: 100 }, suffix, 1000)).toBe(false);
  });
  it("re-emits only a well-formed unsatisfied total", () => {
    expect(unsatisfiedContentRange("bytes */123")).toBe("bytes */123");
    expect(unsatisfiedContentRange("bytes */abc")).toBeNull();
    expect(unsatisfiedContentRange(null)).toBeNull();
  });
});
