import { describe, expect, it } from "vitest";
import { describeAuditMetadata, humanizeKey, humanizeValue, summarizeAuditDetails } from "./audit-details";

describe("humanizeKey", () => {
  it("turns snake_case into a label", () => {
    expect(humanizeKey("decision_reason")).toBe("Decision reason");
    expect(humanizeKey("org-type")).toBe("Org type");
  });
});

describe("humanizeValue", () => {
  it("never emits JSON braces", () => {
    expect(humanizeValue({ a: 1, b_c: "x" })).toBe("A: 1, B c: x");
    expect(humanizeValue(["a", "b"])).toBe("a, b");
  });
  it("treats null / empty as nothing", () => {
    expect(humanizeValue(null)).toBeNull();
    expect(humanizeValue("")).toBeNull();
    expect(humanizeValue({})).toBeNull();
  });
});

describe("describeAuditMetadata", () => {
  it("extracts reason, reference, before and after", () => {
    const d = describeAuditMetadata({ decision_reason: "Duplicate", verification_id: "v-1", old_role: "support", new_role: "moderator", note: "hi" });
    expect(d.reason).toBe("Duplicate");
    expect(d.referenceId).toBe("v-1");
    expect(d.before).toBe("support");
    expect(d.after).toBe("moderator");
    expect(d.rest).toEqual([{ key: "Note", value: "hi" }]);
  });
  it("keeps unrecognised facts instead of dropping them", () => {
    expect(describeAuditMetadata({ points_delta: 100 }).rest).toEqual([{ key: "Points delta", value: "100" }]);
  });
  it("tolerates empty, null and non-object metadata", () => {
    for (const bad of [null, undefined, [], "x", 3]) {
      expect(describeAuditMetadata(bad)).toEqual({ reason: null, referenceId: null, before: null, after: null, rest: [] });
    }
  });
});

describe("summarizeAuditDetails", () => {
  it("prefers the reason and truncates long text", () => {
    expect(summarizeAuditDetails(describeAuditMetadata({ reason: "Because" }))).toBe("Because");
    expect(summarizeAuditDetails(describeAuditMetadata({ reason: "x".repeat(200) }), 10)).toHaveLength(10);
  });
  it("is null when nothing was recorded", () => {
    expect(summarizeAuditDetails(describeAuditMetadata({}))).toBeNull();
  });
});
