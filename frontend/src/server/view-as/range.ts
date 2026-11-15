/**
 * HTTP Range parsing for the View-As media door. Only ONE byte range is accepted: `bytes=a-b`, `bytes=a-` or `bytes=-n`.
 * Multi-range, a non-`bytes` unit, a malformed value, a zero suffix, an inverted range and anything that is not a safe
 * integer is "invalid" (the route answers 416). The parser knows nothing about the object size: the range sent upstream is
 * clamped to a per-response cap, and the size comes back in the upstream `Content-Range`, which is validated separately.
 */
export type ByteRange =
  | { kind: "none" }
  | { kind: "from"; start: number; end: number | null }
  | { kind: "suffix"; length: number };

const DIGITS = /^\d{1,15}$/;

export function parseRangeHeader(header: string | null): ByteRange | "invalid" {
  if (header === null) return { kind: "none" };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());           // a comma (multi-range), another unit or junk fails here
  if (!m) return "invalid";
  const [, a = "", b = ""] = m;
  if (a === "") {
    if (!DIGITS.test(b)) return "invalid";
    const length = Number(b);
    return length > 0 ? { kind: "suffix", length } : "invalid";
  }
  if (!DIGITS.test(a) || (b !== "" && !DIGITS.test(b))) return "invalid";
  const start = Number(a);
  const end = b === "" ? null : Number(b);
  if (end !== null && end < start) return "invalid";
  return { kind: "from", start, end };
}

/** The `Range` value to ask upstream for: the requested range clamped to `cap` bytes (a shorter 206 is always valid). */
export function upstreamRange(range: Exclude<ByteRange, { kind: "none" }>, cap: number): string {
  if (range.kind === "suffix") return `bytes=-${Math.min(range.length, cap)}`;
  const last = range.start + cap - 1;
  return `bytes=${range.start}-${range.end === null ? last : Math.min(range.end, last)}`;
}

export type ContentRange = { start: number; end: number; total: number };

/** Parses an upstream `Content-Range: bytes s-e/total` (or null when it is not one). */
export function parseContentRange(value: string | null): ContentRange | null {
  const m = value === null ? null : /^bytes (\d{1,15})-(\d{1,15})\/(\d{1,15})$/.exec(value);
  if (!m) return null;
  const [start, end, total] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return end >= start && end < total ? { start, end, total } : null;
}

/** True when an upstream 206 really answers the range asked for (start, bound and cap), so a surprise range is never relayed. */
export function contentRangeMatches(got: ContentRange, range: Exclude<ByteRange, { kind: "none" }>, cap: number): boolean {
  const length = got.end - got.start + 1;
  if (length > cap) return false;
  if (range.kind === "suffix") return got.end === got.total - 1 && length <= range.length;
  if (got.start !== range.start) return false;
  return range.end === null || got.end <= range.end;
}

// The Content-Range for a 416 ("bytes", a star, "/total") when the total is known upstream.
export function unsatisfiedContentRange(value: string | null): string | null {
  const m = value === null ? null : /^bytes \*\/(\d{1,15})$/.exec(value);
  return m ? `bytes */${m[1]}` : null;
}
