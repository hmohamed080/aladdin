import { describe, expect, it } from "vitest";
import { createTranslator } from "./translate";
import { tradeLabel, specializationLabel } from "./trade-label";

const en = createTranslator("en");
const ar = createTranslator("ar");

/**
 * Both functions exist for one reason: `t()` returns the KEY PATH when nothing
 * resolves, and every surface these feed — the profile, the dashboard, the
 * public page a stranger reads — would otherwise print
 * `onboarding.professional.specializations.something` verbatim. That is the
 * exact defect the language normalizer was written for, one column over.
 */
describe("tradeLabel", () => {
  it("translates every seeded trade key in both locales", () => {
    const seeded = [
      "kitchens_doors",
      "plumbing",
      "electrical",
      "hvac",
      "gypsum_paint",
      "tiling",
      "marble_granite",
    ];
    for (const key of seeded) {
      expect(tradeLabel(en, key), `${key} EN`).not.toMatch(/^onboarding\./);
      expect(tradeLabel(ar, key), `${key} AR`).not.toMatch(/^onboarding\./);
      // And the two locales genuinely differ — a missing AR entry would fall
      // back to the key and quietly pass an "is not a path" check on its own.
      expect(tradeLabel(ar, key)).not.toBe(tradeLabel(en, key));
    }
  });

  it("labels the two trades added with the taxonomy", () => {
    expect(tradeLabel(en, "tiling")).toBe("Tiling");
    expect(tradeLabel(en, "marble_granite")).toBe("Marble & granite");
    expect(tradeLabel(ar, "marble_granite")).toBe("رخام وجرانيت");
  });

  /**
   * An unknown key returns the KEY, never a message path. A path tells a visitor
   * nothing except that something is broken, and they cannot tell whose fault it
   * is; the key is at least a word.
   */
  it("falls back to the key rather than to a message path", () => {
    expect(tradeLabel(en, "not_a_trade")).toBe("not_a_trade");
  });
});

describe("specializationLabel", () => {
  /**
   * `individual_onboarding.prof_specialization` genuinely holds two conventions:
   * a vocabulary key where the onboarding chips wrote it, and free prose in
   * every seeded and staging professional.
   */
  it("translates a value that is a vocabulary key", () => {
    expect(specializationLabel(en, "gypsum_paint")).toBe("Gypsum & paint");
    expect(specializationLabel(ar, "gypsum_paint")).toBe("جبس ودهانات");
  });

  it("shows prose as written instead of as a key path", () => {
    expect(specializationLabel(en, "Marble and granite fixing")).toBe("Marble and granite fixing");
    expect(specializationLabel(en, "Plumbing and sanitary fitting")).toBe(
      "Plumbing and sanitary fitting",
    );
  });

  /**
   * IT DOES NOT INFER. "Plumbing and sanitary fitting" is not turned into
   * `plumbing`, here or anywhere: a guess that is right four times and wrong once
   * has published a claim the professional never made. Prose stays prose, and the
   * canonical trade comes from an explicit selection or an explicit seed mapping.
   */
  it("never maps prose onto a canonical trade", () => {
    expect(specializationLabel(en, "Plumbing and sanitary fitting")).not.toBe("Plumbing");
    expect(specializationLabel(en, "Ceramic and porcelain tiling")).not.toBe("Tiling");
  });

  it("treats an empty or blank value as nothing to show", () => {
    expect(specializationLabel(en, "")).toBe("");
    expect(specializationLabel(en, "   ")).toBe("");
  });
});
