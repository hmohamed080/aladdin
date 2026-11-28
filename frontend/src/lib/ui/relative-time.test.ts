import { describe, expect, it } from "vitest";
import { relativeTime } from "./relative-time";

const NOW = Date.parse("2026-10-22T12:00:00Z");

describe("relativeTime", () => {
  it("reads minutes, hours and days in English", () => {
    expect(relativeTime("2026-10-22T11:55:00Z", "en", NOW)).toBe("5 minutes ago");
    expect(relativeTime("2026-10-22T09:00:00Z", "en", NOW)).toBe("3 hours ago");
    expect(relativeTime("2026-10-20T12:00:00Z", "en", NOW)).toBe("2 days ago");
  });

  it("answers in Arabic for the Arabic locale", () => {
    expect(relativeTime("2026-10-22T11:55:00Z", "ar", NOW)).toContain("دقائق");
  });

  it("treats under a minute, the future and bad input as now", () => {
    expect(relativeTime("2026-10-22T11:59:40Z", "en", NOW)).toBe("now");
    expect(relativeTime("2026-10-22T13:00:00Z", "en", NOW)).toBe("now");
    expect(relativeTime(null, "en", NOW)).toBe("now");
    expect(relativeTime("not a date", "en", NOW)).toBe("now");
  });
});
