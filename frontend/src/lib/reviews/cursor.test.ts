import { describe, expect, it } from "vitest";
import { decodeReviewCursor, encodeReviewCursor } from "./cursor";

const ID = "3f2b8c1e-5a4d-4e6f-9a7b-0c1d2e3f4a5b";
const AT = "2026-09-01T10:20:30.123456+00:00";

describe("the review cursor", () => {
  it("round-trips a created_at and an id exactly, microseconds included", () => {
    const raw = encodeReviewCursor({ createdAt: AT, id: ID });
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeReviewCursor(raw)).toEqual({ createdAt: AT, id: ID });
  });

  it("refuses to encode a value that is not an instant and a UUID", () => {
    expect(encodeReviewCursor({ createdAt: "yesterday", id: ID })).toBeNull();
    expect(encodeReviewCursor({ createdAt: AT, id: "not-a-uuid" })).toBeNull();
  });

  it("decodes anything that is not exactly what encode produced to null", () => {
    const filterInjection = btoa(`${AT},or=(id.neq.0)|${ID}`).replace(/=+$/, "");
    const idInjection = btoa(`${AT}|${ID},id.gt.0`).replace(/=+$/, "");
    for (const bad of [
      "", "   ", "%%%", "plainly not base64!", "a".repeat(201),
      btoa("only-one-part"), btoa(`${AT}|${ID}|extra`), btoa(`2026-13-45T99:99:99Z|${ID}`),
      btoa(`${AT}|zzzz`), filterInjection, idInjection,
      undefined, null, 42, {},
    ]) {
      expect(decodeReviewCursor(bad)).toBeNull();
    }
  });

  it("a cursor can never carry filter syntax into the query", () => {
    const decoded = decodeReviewCursor(encodeReviewCursor({ createdAt: AT, id: ID }));
    expect(`${decoded?.createdAt}${decoded?.id}`).not.toMatch(/[(),]/);
  });
});
