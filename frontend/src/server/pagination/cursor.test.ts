import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  InvalidCursorError,
  WORK_CURSOR_SORTS,
  decodeJobCursor,
  decodeWorkCursor,
  encodeJobCursor,
  encodeWorkCursor,
  questionHash,
  type WorkKeyset,
} from "./cursor";
import type { JobKeyset } from "@/server/queries/job-opportunities";

const ID = "3f2b8c1e-7a44-4d0b-9c55-1a2b3c4d5e6f";
const P = "2026-10-06T10:11:40.123456+00:00";
const Q = "trade=tiling&sort=highest";

const jobCursors: JobKeyset[] = [
  { sort: "newest", publishedAt: P, id: ID },
  { sort: "highest", amount: 4500.5, publishedAt: P, id: ID },
  { sort: "nearest", tier: 0, publishedAt: P, id: ID },
  { sort: "nearest", tier: 2, publishedAt: P, id: ID },
  { sort: "nearest", tier: 3, publishedAt: P, id: ID },
];

const b64 = (o: unknown) => `v1.${btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;

describe("job cursors — opaque, validated, bound to a sort and a question", () => {
  it.each(jobCursors)("round-trips %j", (keyset) => {
    const cursor = encodeJobCursor(keyset, Q);
    expect(cursor).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
    expect(decodeJobCursor(cursor, keyset.sort, Q)).toEqual(keyset);
  });

  it("is opaque text — nothing readable about the position or the caller", () => {
    const cursor = encodeJobCursor({ sort: "newest", publishedAt: P, id: ID }, Q);
    expect(cursor).not.toContain(ID);
    expect(cursor).not.toContain("2026");
  });

  it("is refused by another sort — a Nearest cursor means nothing to Highest pay", () => {
    const cursor = encodeJobCursor({ sort: "nearest", tier: 1, publishedAt: P, id: ID }, Q);
    expect(decodeJobCursor(cursor, "highest", Q)).toBeNull();
    expect(decodeJobCursor(cursor, "newest", Q)).toBeNull();
  });

  it("is refused by another question — a cursor from one filter set cannot continue a different list", () => {
    const cursor = encodeJobCursor({ sort: "newest", publishedAt: P, id: ID }, "trade=tiling");
    expect(decodeJobCursor(cursor, "newest", "trade=painting")).toBeNull();
    expect(decodeJobCursor(cursor, "newest", "trade=tiling")).not.toBeNull();
  });

  it.each([
    ["not a string", 42],
    ["empty", ""],
    ["no version", "abc"],
    ["wrong version", "v2.abc"],
    ["extra segment", "v1.abc.def"],
    ["not base64", "v1.!!!"],
    ["not JSON", `v1.${btoa("not json")}`],
    ["a JSON array", b64([1, 2])],
    ["too long", `v1.${"a".repeat(700)}`],
  ])("refuses %s", (_label, value) => {
    expect(decodeJobCursor(value, "newest", Q)).toBeNull();
  });

  it("refuses a hand-made payload whose fields are not what they must be", () => {
    const q = questionHash(Q);
    const ok = { s: "newest", p: P, i: ID, q };
    expect(decodeJobCursor(b64(ok), "newest", Q)).not.toBeNull();
    for (const bad of [
      { ...ok, i: "not-a-uuid" },
      { ...ok, i: `${ID}'; drop table jobs; --` },
      { ...ok, p: "yesterday" },
      { ...ok, p: `${P}",id.gt."` },
      { ...ok, s: "oldest" },
      { s: "newest", p: P, q },
      { ...ok, q: q + 1 },
    ]) expect(decodeJobCursor(b64(bad), "newest", Q)).toBeNull();
    const hi = { s: "highest", p: P, i: ID, q };
    for (const bad of [{ ...hi, a: "5000" }, { ...hi, a: -1 }, { ...hi, a: 1e13 }, { ...hi }, { ...hi, a: null }]) {
      expect(decodeJobCursor(b64(bad), "highest", Q)).toBeNull();
    }
    const near = { s: "nearest", p: P, i: ID, q };
    for (const bad of [{ ...near, t: 4 }, { ...near, t: "1" }, { ...near, t: -1 }, { ...near, t: 1.5 }, { ...near, t: null }, { ...near }]) {
      expect(decodeJobCursor(b64(bad), "nearest", Q)).toBeNull();
    }
  });
});

describe("work cursors", () => {
  const stamp = "2026-10-05T09:30:00.000000+00:00";
  const cases: WorkKeyset[] = [
    { sort: "default", key: stamp, key2: null, id: ID },
    { sort: "recent-added", key: stamp, key2: null, id: ID },
    { sort: "last-added", key: stamp, key2: null, id: ID },
    { sort: "oldest-first", key: stamp, key2: null, id: ID },
    { sort: "last-action", key: stamp, key2: "2026-10-01T08:00:00+00:00", id: ID },
    { sort: "last-action", key: null, key2: "2026-10-01T08:00:00+00:00", id: ID },
  ];

  it("covers every supported sort", () => {
    expect(new Set(cases.map((c) => c.sort))).toEqual(new Set(WORK_CURSOR_SORTS));
  });

  it.each(cases)("round-trips %j", (keyset) => {
    expect(decodeWorkCursor(encodeWorkCursor(keyset, "state=completed"), keyset.sort, "state=completed")).toEqual(keyset);
  });

  it("is bound to its sort and its question", () => {
    const cursor = encodeWorkCursor(cases[0]!, "state=completed");
    expect(decodeWorkCursor(cursor, "last-action", "state=completed")).toBeNull();
    expect(decodeWorkCursor(cursor, "default", "state=in_progress")).toBeNull();
  });

  it("refuses malformed keys, and a second key on a sort that has only one", () => {
    const q = questionHash("");
    expect(decodeWorkCursor(b64({ s: "default", a: "soon", b: null, i: ID, q }), "default", "")).toBeNull();
    expect(decodeWorkCursor(b64({ s: "default", a: stamp, b: stamp, i: ID, q }), "default", "")).toBeNull();
    expect(decodeWorkCursor(b64({ s: "default", a: stamp, b: null, i: "x", q }), "default", "")).toBeNull();
    expect(decodeWorkCursor("v1.", "default", "")).toBeNull();
  });
});

describe("misc", () => {
  it("questionHash is stable and separates different questions", () => {
    expect(questionHash("a=1")).toBe(questionHash("a=1"));
    expect(questionHash("a=1")).not.toBe(questionHash("a=2"));
  });

  it("InvalidCursorError is a real Error the loaders can throw", () => {
    expect(new InvalidCursorError()).toBeInstanceOf(Error);
    expect(new InvalidCursorError().name).toBe("InvalidCursorError");
  });
});
