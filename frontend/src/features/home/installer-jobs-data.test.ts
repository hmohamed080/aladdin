import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n/translate";
import type { OpportunityRow } from "@/server/queries/job-opportunities";
import { jobCountLabel, jobPageLabel, toJobCardVM, toJobCardVMs } from "./installer-jobs-data";

const t = createTranslator("en");

function row(over: Partial<OpportunityRow> = {}): OpportunityRow {
  return {
    id: "job-1",
    title: "Install SPC flooring",
    description: "A villa",
    trade_key: "flooring",
    poster_org_id: "org-1",
    poster_org_name: "Modern Floors",
    governorate: "Cairo",
    city: "New Cairo",
    offered_amount: 4500,
    offered_currency: "EGP",
    expected_duration_days: 3,
    starts_on: "2026-11-01",
    ends_by: "2026-11-10",
    published_at: "2026-10-01T10:00:00Z",
    has_applied: false,
    ...over,
  };
}

describe("toJobCardVM — real rows, honest omissions", () => {
  it("maps the fields the read seam actually holds", () => {
    const vm = toJobCardVM(row(), t, "en")!;
    expect(vm).toMatchObject({
      id: "job-1",
      title: "Install SPC flooring",
      org: "Modern Floors",
      place: "New Cairo, Cairo", // the catalogue's own English names, joined with the language's comma
      tradeKey: "flooring",
      durationDays: 3,
      amount: 4500,
      hasApplied: false,
      href: "/home/jobs/job-1",
    });
    expect(vm.postedLabel).toMatch(/^Posted /);
  });

  it("never supplies a distance, a skill-match, or an image", () => {
    const vm = toJobCardVM(row(), t, "en")!;
    expect(vm.distanceKm).toBeNull();
    expect(vm.matchPercent).toBeNull();
    expect(vm.image).toBeNull();
  });

  it("keeps a missing budget missing — never 0", () => {
    expect(toJobCardVM(row({ offered_amount: null }), t, "en")!.amount).toBeNull();
  });

  it("keeps a fractional amount exactly", () => {
    expect(toJobCardVM(row({ offered_amount: 4500.5 }), t, "en")!.amount).toBe(4500.5);
  });

  it("omits unknown facts instead of inventing them", () => {
    const vm = toJobCardVM(row({ poster_org_name: null, city: null, governorate: null, expected_duration_days: null, published_at: null, trade_key: null }), t, "en")!;
    expect(vm.org).toBeNull();
    expect(vm.place).toBeNull();
    expect(vm.durationDays).toBeNull();
    expect(vm.postedLabel).toBeNull();
    expect(vm.tradeLabel).toBeNull();
  });

  it("carries the real applied state", () => {
    expect(toJobCardVM(row({ has_applied: true }), t, "en")!.hasApplied).toBe(true);
    expect(toJobCardVM(row({ has_applied: null }), t, "en")!.hasApplied).toBe(false);
  });

  it("skips a row missing its id or title rather than drawing it half blank", () => {
    expect(toJobCardVMs([row({ id: null }), row({ title: null }), row({ id: "ok" })], t, "en").map((v) => v.id)).toEqual(["ok"]);
  });
});

describe("jobCountLabel — never claims a total from a capped read", () => {
  it("is exact when the read came back short of its cap", () => {
    expect(jobCountLabel(7, 100, "en")).toBe("7 opportunities available");
    expect(jobCountLabel(1, 100, "en")).toBe("1 opportunity available");
    expect(jobCountLabel(0, 100, "en")).toBe("0 opportunities available");
  });

  it("says only 'up to N' once the cap is reached", () => {
    expect(jobCountLabel(100, 100, "en")).toBe("Showing up to 100 opportunities");
    expect(jobCountLabel(100, 100, "en")).not.toMatch(/available/);
  });

  it("is localised", () => {
    expect(jobCountLabel(100, 100, "ar")).toContain("حتى");
    expect(jobCountLabel(3, 100, "ar")).toContain("٣");
  });
});

describe("jobPageLabel — a REAL page states an exact total", () => {
  it("says 'Showing X of N' while more exist", () => {
    expect(jobPageLabel(6, 23, "en")).toBe("Showing 6 of 23 opportunities");
    expect(jobPageLabel(6, 23, "ar")).toBe("عرض ٦ من ٢٣ فرصة");
  });
  it("reads like the unpaged label once everything is shown", () => {
    expect(jobPageLabel(8, 8, "en")).toBe("8 opportunities available");
    expect(jobPageLabel(1, 1, "en")).toBe("1 opportunity available");
  });
});

describe("jobPageLabel for Nearest — the same exact sentence, because Nearest is a real page now", () => {
  it("states the database's exact total whatever the ordering, with no 'among the newest N' qualifier", () => {
    expect(jobPageLabel(6, 340, "en")).toBe("Showing 6 of 340 opportunities");
    expect(jobPageLabel(6, 340, "en")).not.toMatch(/newest/i);
  });
});
