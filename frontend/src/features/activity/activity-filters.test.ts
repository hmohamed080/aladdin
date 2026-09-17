import { describe, expect, it } from "vitest";

import { activityFilterHref, activityPageHref } from "./activity-filters";

describe("activity filter links", () => {
  it("drops a stale cursor whenever a filter changes", () => {
    const href = activityFilterHref(
      {
        family: "rfq",
        from: "2026-09-01",
        to: "2026-09-09",
        before: "stale-opaque-cursor",
      },
      { family: "order" },
    );

    expect(href).toBe("/b2b/activity?family=order&from=2026-09-01&to=2026-09-09");
    expect(href).not.toContain("before=");
  });

  it("keeps validated filters when building an older-page link", () => {
    expect(
      activityPageHref(
        { family: "quotation", from: "2026-09-01", to: "2026-09-09" },
        "opaque+/cursor",
      ),
    ).toBe(
      "/b2b/activity?family=quotation&from=2026-09-01&to=2026-09-09&before=opaque%2B%2Fcursor",
    );
  });
});
