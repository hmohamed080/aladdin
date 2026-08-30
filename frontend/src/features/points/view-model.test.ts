import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n/translate";
import {
  toPointsEntryView,
  toPointsEntryViews,
  formatPointsBalance,
  isKnownPointsEvent,
  KNOWN_POINTS_EVENTS,
  type PointsEntrySource,
} from "./view-model";

const en = createTranslator("en");
const ar = createTranslator("ar");

const entry = (over: Partial<PointsEntrySource> = {}): PointsEntrySource => ({
  id: "e1",
  event_type: "referral.organization_approved",
  points_delta: 100,
  reverses_entry_id: null,
  reason_code: null,
  organization_id: null,
  created_at: "2026-08-30T10:00:00Z",
  ...over,
});

describe("the known event vocabulary", () => {
  it("matches the database allow-list exactly", () => {
    // ck_points_ledger_event_type_known permits these two and nothing else.
    expect([...KNOWN_POINTS_EVENTS]).toEqual([
      "referral.organization_approved",
      "admin.adjustment",
    ]);
  });

  it("does not treat a deferred Tier B event as known", () => {
    expect(isKnownPointsEvent("quotation.accepted")).toBe(false);
    expect(isKnownPointsEvent("order.completed")).toBe(false);
  });
});

describe("the referral award", () => {
  it("reads as an approved referral worth 100 Points", () => {
    const v = toPointsEntryView(entry(), en, "en");
    expect(v.title).toBe("Referral approved");
    expect(v.body).toContain("100 Points");
    expect(v.deltaLabel).toBe("+100");
    expect(v.direction).toBe("earned");
    expect(v.degraded).toBe(false);
  });

  it("renders in Arabic with no English left in it", () => {
    const v = toPointsEntryView(entry(), ar, "ar");
    expect(v.title).toBe("تم اعتماد إحالتك");
    expect(v.body).toMatch(/[؀-ۿ]/);
    expect(v.title).not.toMatch(/[A-Za-z]/);
  });

  it("shows organization context only when a name resolved", () => {
    const withOrg = entry({ organization_id: "o9" });
    expect(toPointsEntryView(withOrg, en, "en", new Map([["o9", "Zayed Tiles"]])).organizationName)
      .toBe("Zayed Tiles");
    // Not resolvable (the reader has left that business) — omitted, not faked.
    expect(toPointsEntryView(withOrg, en, "en", new Map()).organizationName).toBeNull();
    expect(toPointsEntryView(entry(), en, "en").organizationName).toBeNull();
  });
});

describe("administrative adjustments and corrections", () => {
  it("presents a positive adjustment as an adjustment", () => {
    const v = toPointsEntryView(
      entry({ event_type: "admin.adjustment", points_delta: 25, reason_code: "support_correction" }),
      en,
      "en",
    );
    expect(v.title).toBe("Points adjustment");
    expect(v.deltaLabel).toBe("+25");
    expect(v.direction).toBe("earned");
  });

  it("presents a negative adjustment as a correction, not as something earned", () => {
    const v = toPointsEntryView(
      entry({ event_type: "admin.adjustment", points_delta: -40, reason_code: "event_invalidated" }),
      en,
      "en",
    );
    expect(v.title).toBe("Points correction");
    expect(v.direction).toBe("deducted");
    expect(v.deltaLabel).toMatch(/^[-−]40$/);
  });

  it("presents a reversal as a correction that stands beside the original", () => {
    const v = toPointsEntryView(
      entry({ points_delta: -100, reverses_entry_id: "e0", reason_code: "support_correction" }),
      en,
      "en",
    );
    expect(v.title).toBe("Points correction");
    expect(v.body).toBe("Adjusted by the Aladdin team after a review.");
    expect(v.direction).toBe("deducted");
  });

  it("keeps the original award in the list beside its reversal", () => {
    // The pair is two rows. Collapsing them would rewrite history on screen
    // while the database refused to rewrite it on disk.
    const views = toPointsEntryViews(
      [entry({ id: "rev", points_delta: -100, reverses_entry_id: "orig" }), entry({ id: "orig" })],
      en,
      "en",
    );
    expect(views.map((v) => v.id)).toEqual(["rev", "orig"]);
    expect(views.at(0)?.title).toBe("Points correction");
    expect(views.at(1)?.title).toBe("Referral approved");
  });

  it("omits a reason it has no approved copy for rather than printing the raw code", () => {
    const v = toPointsEntryView(
      entry({ event_type: "admin.adjustment", points_delta: -5, reason_code: "some_future_code" }),
      en,
      "en",
    );
    expect(v.body).toBeNull();
    expect(JSON.stringify(v)).not.toContain("some_future_code");
  });
});

describe("unknown events degrade instead of disappearing", () => {
  it("renders a neutral localized row", () => {
    const v = toPointsEntryView(entry({ event_type: "future.event" }), en, "en");
    expect(v.title).toBe("Points activity");
    expect(v.degraded).toBe(true);
    expect(v.deltaLabel).toBe("+100");
  });

  it("never drops the row — the balance already counts it", () => {
    const views = toPointsEntryViews([entry({ event_type: "future.event" })], en, "en");
    expect(views).toHaveLength(1);
  });

  it("degrades in Arabic too, with no raw key leaking", () => {
    const v = toPointsEntryView(entry({ event_type: "future.event" }), ar, "ar");
    expect(v.title).toBe("حركة نقاط");
    expect(v.title).not.toContain("future.event");
  });
});

describe("nothing internal reaches the screen", () => {
  it("exposes no source id, audit id, admin id, reversal link or metadata", () => {
    const v = toPointsEntryView(
      entry({
        id: "11111111-1111-4111-8111-111111111111",
        event_type: "admin.adjustment",
        points_delta: -40,
        reverses_entry_id: "22222222-2222-4222-8222-222222222222",
        reason_code: "support_correction",
      }),
      en,
      "en",
    );
    // `id` survives as a React key and is asserted separately below; nothing
    // else internal may appear anywhere in the rendered strings.
    const rendered = [v.title, v.body, v.deltaLabel, v.deltaDescription, v.dateLabel].join(" ");
    expect(rendered).not.toContain("22222222");
    expect(rendered).not.toContain("support_correction");
    expect(rendered).not.toContain("admin.adjustment");
    expect(rendered).not.toContain("points_delta");
    expect(v).not.toHaveProperty("metadata");
    expect(v).not.toHaveProperty("source_id");
    expect(v).not.toHaveProperty("awarded_by_user_id");
    expect(v).not.toHaveProperty("reverses_entry_id");
  });

  it("never shows a raw event key to a reader", () => {
    const v = toPointsEntryView(entry(), en, "en");
    expect(v.title).not.toContain("referral.organization_approved");
    expect(v.body).not.toContain("referral.organization_approved");
  });
});

describe("the sign is data, not decoration", () => {
  it("gives a screen reader a sentence in both directions", () => {
    expect(toPointsEntryView(entry(), en, "en").deltaDescription).toBe("earned 100 Points");
    expect(
      toPointsEntryView(entry({ points_delta: -40, reverses_entry_id: "x" }), en, "en")
        .deltaDescription,
    ).toBe("40 Points deducted");
  });

  it("keeps the delta readable in Arabic", () => {
    const v = toPointsEntryView(entry({ points_delta: -40, reverses_entry_id: "x" }), ar, "ar");
    expect(v.deltaDescription).toMatch(/[؀-ۿ]/);
    // Arabic-Indic digits, and a sign that Intl produced rather than one glued
    // on by hand — which is what keeps it on the correct side of the number.
    expect(v.deltaLabel).toMatch(/[٠-٩]/);
  });
});

describe("the balance is never reinterpreted", () => {
  it("preserves a negative total instead of clamping or dashing it", () => {
    expect(formatPointsBalance(-40, "en")).toMatch(/^[-−]40$/);
    expect(formatPointsBalance(-40, "en")).not.toBe("0");
    expect(formatPointsBalance(-40, "en")).not.toBe("—");
  });

  it("formats zero and positive totals for the locale", () => {
    expect(formatPointsBalance(0, "en")).toBe("0");
    expect(formatPointsBalance(100, "en")).toBe("100");
    expect(formatPointsBalance(100, "ar")).toMatch(/[٠-٩]/);
  });

  it("carries no currency symbol in either locale", () => {
    for (const locale of ["en", "ar"] as const) {
      const out = formatPointsBalance(1250, locale);
      expect(out).not.toMatch(/EGP|ج\.م|\$|£|€/);
    }
  });
});
