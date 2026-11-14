import { describe, expect, it } from "vitest";
import { parseDashboard, parsePoints, parsePortfolio, parseProfile, parseReviews, parseWork } from "./craftsman-data";

describe("craftsman view-as parsers", () => {
  it.each([
    ["dashboard", parseDashboard],
    ["profile", parseProfile],
    ["portfolio", parsePortfolio],
    ["work", parseWork],
    ["points", parsePoints],
    ["reviews", parseReviews],
  ] as const)("%s degrades to empty values on garbage and never throws", (_n, parse) => {
    for (const raw of [null, undefined, "x", 7, [], {}, { projects: "no", items: 5, entries: {} }]) {
      expect(() => parse(raw)).not.toThrow();
    }
  });

  it("dashboard copies only the allow-listed fields", () => {
    const d = parseDashboard({
      display_name: "Ahmed", account_status: "active", completion: { percent: 140, missing: ["avatar", 3] },
      work_counts: { completed: 2, in_progress: "1" }, points: { balance: 100, month_earned: 40 }, reviews: { total: 2, average: "4.5" },
      verification: { type: "professional", status: "approved", submitted_at: "2026-10-01" },
      password_hash: "SECRET", object_key: "abc.jpg",
    });
    expect(d.completion).toEqual({ percent: 100, missing: ["avatar"] }); // clamped, non-strings dropped
    expect(d.workCounts).toEqual({ completed: 2, in_progress: 1 });
    expect(d.reviewsAverage).toBe(4.5);
    expect(JSON.stringify(d)).not.toMatch(/SECRET|abc\.jpg|password/);
  });

  it("profile never surfaces an unknown (possibly sensitive) field", () => {
    const p = parseProfile({ display_name: "A", phone: "+2010", secondary_phone_masked: "•••999", auth_token: "T", object_key: "k.jpg", trades: [{ key: "tiling", is_primary: true }, {}], service_areas: [{ governorate: "cairo", city: null, is_primary: true }] });
    expect(p.secondaryPhoneMasked).toBe("•••999");
    expect(p.trades).toEqual([{ key: "tiling", isPrimary: true }]);
    expect(JSON.stringify(p)).not.toMatch(/auth_token|k\.jpg/);
  });

  it("portfolio keeps media as kind only and drops rows without an id", () => {
    const o = parsePortfolio({
      projects: [{ id: "p1", title: "Villa", object_key: "x.jpg", items: [{ id: "i1", kind: "video", object_key: "y.mp4" }, { title: "no id" }] }, { title: "no id" }],
      certificates: [{ id: "c1", title: "T", kind: "pdf", object_path: "u/z.pdf", original_filename: "private.pdf" }],
    });
    expect(o.projects).toHaveLength(1);
    expect(o.projects[0]!.items).toEqual([{ id: "i1", title: null, kind: "video", visibility: null, state: null }]);
    expect(o.certificates[0]!.kind).toBe("pdf");
    expect(JSON.stringify(o)).not.toMatch(/x\.jpg|y\.mp4|z\.pdf|private\.pdf|object_/);
  });

  it("work, points and reviews coerce numbers and keep only known fields", () => {
    expect(parseWork({ counts: { completed: 1 }, items: [{ id: "a", status: "completed", job_title: "J", agreed_amount: "9000", site_address: "SECRET", contact_phone: "010" }] }).items[0]).toMatchObject({ jobTitle: "J", agreedAmount: 9000 });
    expect(JSON.stringify(parseWork({ items: [{ id: "a", site_address: "SECRET", contact_phone: "010" }] }))).not.toMatch(/SECRET|010/);
    expect(parsePoints({ balance: "100", entries: [{ id: "e", points_delta: -5, event_type: "admin.adjustment" }] })).toMatchObject({ balance: 100, entries: [{ delta: -5 }] });
    expect(parseReviews({ total: 1, average: 5, monthly: [{ month: "2026-10-01", reviews: 1, average: 5 }], items: [{ id: "r", rating: 5, comment: "Great" }] }).items[0]).toMatchObject({ rating: 5, comment: "Great" });
  });
});
