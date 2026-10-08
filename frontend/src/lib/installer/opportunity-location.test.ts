import { describe, expect, it } from "vitest";
import {
  buildOpportunityFeed,
  countNearby,
  installerLocationFrom,
  installerLocationLabel,
  matchTier,
  normalizePlace,
  rankByLocation,
  resolveCityKey,
  resolveGovernorateKey,
} from "./opportunity-location";

const cairoNewCairo = installerLocationFrom({ governorate: "cairo", city: null, serviceAreas: ["new-cairo", "maadi"] })!;
const cairoOnly = installerLocationFrom({ governorate: "cairo", city: null, serviceAreas: [] })!;

describe("normalizePlace — only lossless orthographic folding", () => {
  it("folds case, whitespace, Arabic diacritics and tatweel", () => {
    expect(normalizePlace("  New   CAIRO ")).toBe("new cairo");
    expect(normalizePlace("القَاهِرَة")).toBe("القاهرة");
    expect(normalizePlace("القاهـــرة")).toBe("القاهرة");
  });

  it("does NOT merge different spellings — that would be a guess", () => {
    expect(normalizePlace("القاهره")).not.toBe(normalizePlace("القاهرة"));
    expect(normalizePlace("Al Qahira")).not.toBe(normalizePlace("Cairo"));
  });
});

describe("resolving free text against the catalogue", () => {
  it("resolves a governorate only when the text IS one of its catalogue names", () => {
    expect(resolveGovernorateKey("Cairo")).toBe("cairo");
    expect(resolveGovernorateKey("  القاهرة ")).toBe("cairo");
    expect(resolveGovernorateKey("red-sea")).toBe("red-sea");
    expect(resolveGovernorateKey("Red Sea")).toBe("red-sea");
  });

  it("refuses variants, misspellings, affixed and empty values", () => {
    for (const text of ["القاهره", "Cairo Governorate", "محافظة القاهرة", "Al Qahira", "Cairo, Egypt", "", "   ", null, undefined]) {
      expect(resolveGovernorateKey(text as string | null)).toBeNull();
    }
  });

  it("resolves a city only inside the governorate it was resolved under", () => {
    expect(resolveCityKey("cairo", "New Cairo")).toBe("new-cairo");
    expect(resolveCityKey("cairo", "القاهرة الجديدة")).toBe("new-cairo");
    expect(resolveCityKey("giza", "New Cairo")).toBeNull();
    expect(resolveCityKey("cairo", "Maadi, Cairo")).toBeNull();
  });
});

describe("installerLocationFrom", () => {
  it("needs a catalogue governorate; without one there is no location authority", () => {
    expect(installerLocationFrom({ governorate: null, city: null, serviceAreas: ["new-cairo"] })).toBeNull();
    expect(installerLocationFrom({ governorate: "Atlantis", city: null, serviceAreas: [] })).toBeNull();
  });

  it("collects service cities from the catalogue and ignores unknown values and the generic 'other city'", () => {
    const location = installerLocationFrom({ governorate: "cairo", city: "nasr-city", serviceAreas: ["new-cairo", "other", "nowhere"] })!;
    expect([...location.cities].sort()).toEqual(["nasr-city", "new-cairo"]);
  });
});

describe("matchTier — city, then governorate, never distance", () => {
  it("city: same governorate AND one of the installer's service cities", () => {
    expect(matchTier(cairoNewCairo, { governorate: "Cairo", city: "New Cairo" })).toBe("city");
    expect(matchTier(cairoNewCairo, { governorate: "القاهرة", city: "المعادي" })).toBe("city");
  });

  it("governorate: same governorate, a different or unresolved city", () => {
    expect(matchTier(cairoNewCairo, { governorate: "Cairo", city: "Heliopolis" })).toBe("governorate");
    expect(matchTier(cairoNewCairo, { governorate: "Cairo", city: "some neighbourhood" })).toBe("governorate");
    expect(matchTier(cairoNewCairo, { governorate: "Cairo", city: null })).toBe("governorate");
    expect(matchTier(cairoOnly, { governorate: "Cairo", city: "New Cairo" })).toBe("governorate");
  });

  it("none: another governorate, or a governorate string the catalogue cannot vouch for", () => {
    expect(matchTier(cairoNewCairo, { governorate: "Giza", city: "Sheikh Zayed" })).toBe("none");
    expect(matchTier(cairoNewCairo, { governorate: "القاهره", city: "New Cairo" })).toBe("none");
    expect(matchTier(cairoNewCairo, { governorate: null, city: "New Cairo" })).toBe("none");
  });
});

describe("rankByLocation", () => {
  const jobs = [
    { id: "far", governorate: "Giza", city: "Dokki" },
    { id: "gov-old", governorate: "Cairo", city: "Heliopolis" },
    { id: "city", governorate: "Cairo", city: "Maadi" },
    { id: "gov-new", governorate: "القاهرة", city: null },
    { id: "typo", governorate: "القاهره", city: null },
  ];

  it("puts city matches first, then governorate matches, then everything else — keeping order inside a tier", () => {
    expect(rankByLocation(jobs, cairoNewCairo).map((j) => j.id)).toEqual(["city", "gov-old", "gov-new", "far", "typo"]);
  });

  it("leaves the order untouched when there is no usable location", () => {
    expect(rankByLocation(jobs, null).map((j) => j.id)).toEqual(jobs.map((j) => j.id));
  });
});

describe("countNearby — a count or nothing", () => {
  const jobs = [
    { governorate: "Cairo", city: "Maadi", has_applied: false },
    { governorate: "Cairo", city: null, has_applied: false },
    { governorate: "Cairo", city: "Maadi", has_applied: true },
    { governorate: "Giza", city: null, has_applied: false },
  ];

  it("counts provably nearby openings the caller has not applied to", () => {
    expect(countNearby(jobs, cairoNewCairo, true)).toBe(2);
  });

  it("is null — not zero — without a location", () => {
    expect(countNearby(jobs, null, true)).toBeNull();
  });

  it("is null when the list may have been cut short, because a lower bound is not a total", () => {
    expect(countNearby(jobs, cairoNewCairo, false)).toBeNull();
  });

  it("is zero when the list is complete and nothing nearby exists", () => {
    expect(countNearby([{ governorate: "Giza", city: null, has_applied: false }], cairoNewCairo, true)).toBe(0);
  });
});

describe("installerLocationLabel — keys are labelled, unknown text is kept", () => {
  it("shows catalogue labels instead of stored keys", () => {
    expect(installerLocationLabel({ governorate: "cairo", city: "new-cairo" }, "en")).toBe("New Cairo، Cairo");
    expect(installerLocationLabel({ governorate: "cairo", city: "new-cairo" }, "ar")).toBe("القاهرة الجديدة، القاهرة");
    expect(installerLocationLabel({ governorate: "giza", city: null }, "en")).toBe("Giza");
  });

  it("keeps text the catalogue does not know exactly as stored, and is null with nothing at all", () => {
    expect(installerLocationLabel({ governorate: "Cairo Governorate", city: "Zamalek" }, "en")).toBe("Zamalek، Cairo Governorate");
    expect(installerLocationLabel({ governorate: null, city: null }, "en")).toBeNull();
    expect(installerLocationLabel({ governorate: "  ", city: " " }, "ar")).toBeNull();
  });
});

describe("buildOpportunityFeed — the count comes from the whole board, not the cards", () => {
  const job = (id: string, governorate: string, city: string | null, applied = false) => ({ id, governorate, city, has_applied: applied });
  // 9 jobs; 6 are provably nearby (city or governorate), 1 of those already applied to.
  const board = [
    job("n1", "Cairo", "Maadi"),
    job("far1", "Giza", "Dokki"),
    job("n2", "Cairo", "Heliopolis"),
    job("n3", "Cairo", null),
    job("n4", "القاهرة", "المعادي"),
    job("typo", "القاهره", null),
    job("n5", "Cairo", "Nasr City"),
    job("applied", "Cairo", "Maadi", true),
    job("far2", "Alexandria", null),
  ];
  const options = { previewLimit: 3, listLimit: 100 };

  it("shows at most the preview number of cards but counts every nearby opening in the list", () => {
    const feed = buildOpportunityFeed(board, cairoNewCairo, options);
    expect(feed.cards).toHaveLength(3);
    expect(feed.nearbyCount).toBe(5); // n1..n5: more than the 3 cards shown; the applied one is excluded
  });

  it("leads the cards with city matches, then governorate matches", () => {
    const ids = buildOpportunityFeed(board, cairoNewCairo, options).cards.map((j) => j.id);
    expect(ids[0]).toBe("n1");
  });

  it("is null — unknown, not approximate — once the list reaches the row cap", () => {
    expect(buildOpportunityFeed(board, cairoNewCairo, { previewLimit: 3, listLimit: board.length }).nearbyCount).toBeNull();
    expect(buildOpportunityFeed(board, cairoNewCairo, { previewLimit: 3, listLimit: board.length + 1 }).nearbyCount).toBe(5);
  });

  it("is null without a usable installer location, and the cards keep the board's own order", () => {
    const feed = buildOpportunityFeed(board, null, options);
    expect(feed.nearbyCount).toBeNull();
    expect(feed.cards.map((j) => j.id)).toEqual(["n1", "far1", "n2"]);
  });
});

describe("placeLabel — a place in the viewer's language", () => {
  it("names a catalogue place in Arabic and English, whichever language the poster used", async () => {
    const { placeLabel } = await import("./opportunity-location");
    expect(placeLabel("en", "Cairo", "Maadi")).toBe("Maadi, Cairo");
    expect(placeLabel("ar", "Cairo", "Maadi")).toBe("المعادي، القاهرة");
    expect(placeLabel("en", "القاهرة", "المعادي")).toBe("Maadi, Cairo");
    expect(placeLabel("ar", "القاهرة", "المعادي")).toBe("المعادي، القاهرة");
  });

  it("keeps the poster's own words when the text does not resolve — an old job still reads as written", async () => {
    const { placeLabel } = await import("./opportunity-location");
    expect(placeLabel("en", "Atlantis", "Nowhere")).toBe("Nowhere, Atlantis");
    expect(placeLabel("en", "Cairo", "Some neighbourhood")).toBe("Some neighbourhood, Cairo");
    expect(placeLabel("en", null, null)).toBe("");
    expect(placeLabel("ar", "Giza", null)).toBe("الجيزة");
  });
});
