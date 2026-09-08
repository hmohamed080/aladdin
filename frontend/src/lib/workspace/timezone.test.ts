import { describe, expect, it } from "vitest";
import { resolveTimezone } from "./timezone";

describe("resolveTimezone — branch, then org, then Africa/Cairo", () => {
  it("prefers the branch timezone when configured", () => {
    expect(resolveTimezone("Asia/Dubai", "Africa/Cairo")).toBe("Asia/Dubai");
  });

  it("falls back to the organization timezone when the branch has none", () => {
    expect(resolveTimezone(null, "Asia/Riyadh")).toBe("Asia/Riyadh");
    expect(resolveTimezone(undefined, "Asia/Riyadh")).toBe("Asia/Riyadh");
  });

  it("falls back to Africa/Cairo when neither is configured — existing records keep working with no backfill", () => {
    expect(resolveTimezone(null, null)).toBe("Africa/Cairo");
    expect(resolveTimezone(undefined, undefined)).toBe("Africa/Cairo");
  });

  it("treats an empty string the same as absent", () => {
    expect(resolveTimezone("", "Asia/Riyadh")).toBe("Asia/Riyadh");
    expect(resolveTimezone("", "")).toBe("Africa/Cairo");
  });
});
