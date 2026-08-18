import { describe, expect, it } from "vitest";
import { en } from "./messages/en";
import { ar } from "./messages/ar";
import { createTranslator } from "./translate";
import { resolveLocale, directionFor, APP_DEFAULT_LOCALE } from "./config";

/** Collect every leaf key path in a nested message object. */
function keys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === "object" ? keys(v as Record<string, unknown>, path) : [path];
  });
}

/** Collect every leaf [keyPath, value] pair in a nested message object. */
function entries(obj: Record<string, unknown>, prefix = ""): Array<[string, string]> {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === "object"
      ? entries(v as Record<string, unknown>, path)
      : ([[path, String(v)]] as Array<[string, string]>);
  });
}

const ARABIC = /[؀-ۿ]/;
// Values allowed to hold Latin letters in the Arabic catalog: technical samples
// that are identical across locales (e.g. the neutral email placeholder).
// Values that are intentionally identical technical samples in both locales
// (neutral placeholders), so they carry Latin/digits and no Arabic script.
const LATIN_IN_ARABIC_WHITELIST = new Set<string>([
  "auth.emailPlaceholder",
  "onboarding.contact.phonePlaceholder",
  // A KEYCAP legend, not prose. The Enter key is engraved "Enter" on Arabic
  // keyboards too, so translating it would name a key the user cannot find.
  "search.enter",
]);

describe("i18n catalogs", () => {
  it("Arabic has exactly the same keys as English (no missing/extra)", () => {
    const enKeys = keys(en as unknown as Record<string, unknown>).sort();
    const arKeys = keys(ar as unknown as Record<string, unknown>).sort();
    expect(arKeys).toEqual(enKeys);
  });

  it("every Arabic value is a non-empty string", () => {
    for (const path of keys(ar as unknown as Record<string, unknown>)) {
      const value = path
        .split(".")
        .reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], ar);
      expect(typeof value).toBe("string");
      expect((value as string).length).toBeGreaterThan(0);
    }
  });

  it("the English catalog contains no Arabic characters", () => {
    const offenders = entries(en as unknown as Record<string, unknown>)
      .filter(([, value]) => ARABIC.test(value))
      .map(([key]) => key);
    expect(offenders, `English values with Arabic text: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the Arabic catalog contains no unintended English words", () => {
    // Strip {placeholders} first, then flag any run of 3+ Latin letters — that is
    // English UI copy leaking into Arabic (technical samples are whitelisted).
    const offenders = entries(ar as unknown as Record<string, unknown>)
      .filter(([key]) => !LATIN_IN_ARABIC_WHITELIST.has(key))
      .filter(([, value]) => /[A-Za-z]{3,}/.test(value.replace(/\{[^}]*\}/g, "")))
      .map(([key]) => key);
    expect(offenders, `Arabic values with English words: ${offenders.join(", ")}`).toEqual([]);
  });
});

// The character guards above prove NO stray-script leakage but not that a
// specific new surface was actually translated. These target the Sprint 7.2 keys
// (registration / support / invitation / onboarding) and prove each Arabic value
// is real Arabic prose, non-empty, and keeps every placeholder its English pair
// declares — the concrete regression risk when adding a whole new surface.
describe("Sprint 7.2 registration copy (Arabic)", () => {
  const SPRINT_72_PREFIXES = ["support.", "invite.", "onboarding.", "auth.consent.", "auth.signUp", "auth.verify", "auth.recovery"];
  const isNew = (key: string) =>
    SPRINT_72_PREFIXES.some((p) => key.startsWith(p)) ||
    ["auth.createAccount", "auth.haveAccount", "auth.noAccount", "auth.signInLink", "auth.signUpLink", "auth.troubleSigningIn", "auth.lostEmailAccess", "auth.getHelp", "auth.error.consentRequired"].includes(key);

  const enPairs = entries(en as unknown as Record<string, unknown>).filter(([k]) => isNew(k));
  const arMap = new Map(entries(ar as unknown as Record<string, unknown>));

  it("covers a non-trivial set of new keys", () => {
    expect(enPairs.length).toBeGreaterThan(30);
  });

  it("every new Arabic value is present, non-empty, and contains Arabic script", () => {
    const bad = enPairs
      .filter(([key]) => !LATIN_IN_ARABIC_WHITELIST.has(key)) // neutral technical samples
      .map(([key]) => [key, arMap.get(key)] as const)
      .filter(([, v]) => !v || v.trim().length === 0 || !ARABIC.test(v))
      .map(([key]) => key);
    expect(bad, `new keys with missing/empty/non-Arabic values: ${bad.join(", ")}`).toEqual([]);
  });

  it("preserves every placeholder from the English pair (e.g. {email}, {org})", () => {
    const drift: string[] = [];
    for (const [key, enVal] of enPairs) {
      const arVal = arMap.get(key) ?? "";
      const enPlaceholders = (enVal.match(/\{[^}]+\}/g) ?? []).sort();
      const arPlaceholders = (arVal.match(/\{[^}]+\}/g) ?? []).sort();
      if (JSON.stringify(enPlaceholders) !== JSON.stringify(arPlaceholders)) drift.push(key);
    }
    expect(drift, `placeholder drift on: ${drift.join(", ")}`).toEqual([]);
  });
});

// Sprint 7.3 shared onboarding: prove the new step/field/account-type/handoff keys
// exist in both locales, are real Arabic, and keep every placeholder (e.g. the
// {current}/{total} step counter). Parity/leakage are covered by the guards above.
describe("Sprint 7.3 onboarding copy", () => {
  const onboardingEn = entries(en.onboarding as unknown as Record<string, unknown>).map(
    ([k, v]) => [`onboarding.${k}`, v] as [string, string],
  );
  const arMap = new Map(entries(ar as unknown as Record<string, unknown>));

  it("adds the new onboarding step/account-type keys", () => {
    // Baseline plus the new steps, fields, account-type choices, and handoff copy.
    expect(onboardingEn.length).toBeGreaterThan(60);
  });

  it("every onboarding Arabic value is present, non-empty, and real Arabic (bar samples)", () => {
    const bad = onboardingEn
      .filter(([key]) => !LATIN_IN_ARABIC_WHITELIST.has(key))
      .filter(([key]) => {
        const v = arMap.get(key);
        return !v || v.trim().length === 0 || !ARABIC.test(v);
      })
      .map(([key]) => key);
    expect(bad, `onboarding keys missing/empty/non-Arabic: ${bad.join(", ")}`).toEqual([]);
  });

  it("preserves the {current}/{total} step-counter placeholders", () => {
    expect(en.onboarding.stepLabel).toContain("{current}");
    expect(en.onboarding.stepLabel).toContain("{total}");
    expect(ar.onboarding.stepLabel).toContain("{current}");
    expect(ar.onboarding.stepLabel).toContain("{total}");
  });
});

// Sprint 7.4 individual persona onboarding: prove the whole consumer +
// professional persona surface is translated in both locales, is real Arabic
// prose, and preserves placeholders (e.g. the {n} years counter). Parity /
// stray-script leakage are covered by the top-level guards.
describe("Sprint 7.4 individual onboarding copy", () => {
  const consumerEn = entries(en.onboarding.consumer as unknown as Record<string, unknown>).map(
    ([k, v]) => [`onboarding.consumer.${k}`, v] as [string, string],
  );
  const professionalEn = entries(en.onboarding.professional as unknown as Record<string, unknown>).map(
    ([k, v]) => [`onboarding.professional.${k}`, v] as [string, string],
  );
  const all = [...consumerEn, ...professionalEn];
  const arMap = new Map(entries(ar as unknown as Record<string, unknown>));

  it("covers the full consumer + professional persona surface", () => {
    // Five consumer steps + the common professional flow + five personas' options.
    expect(all.length).toBeGreaterThan(120);
  });

  it("every persona Arabic value is present, non-empty, and real Arabic", () => {
    const bad = all
      .map(([key]) => [key, arMap.get(key)] as const)
      .filter(([, v]) => !v || v.trim().length === 0 || !ARABIC.test(v))
      .map(([key]) => key);
    expect(bad, `persona keys missing/empty/non-Arabic: ${bad.join(", ")}`).toEqual([]);
  });

  it("preserves placeholders (e.g. the {n} experience counter)", () => {
    const drift: string[] = [];
    for (const [key, enVal] of all) {
      const arVal = arMap.get(key) ?? "";
      const enPh = (enVal.match(/\{[^}]+\}/g) ?? []).sort();
      const arPh = (arVal.match(/\{[^}]+\}/g) ?? []).sort();
      if (JSON.stringify(enPh) !== JSON.stringify(arPh)) drift.push(key);
    }
    expect(drift, `placeholder drift on: ${drift.join(", ")}`).toEqual([]);
    expect(en.onboarding.professional.review.years).toContain("{n}");
  });
});

describe("translate()", () => {
  it("resolves dotted keys and interpolates placeholders", () => {
    const t = createTranslator("ar");
    expect(t("leads.stages.new")).toBe(ar.leads.stages.new);
    expect(t("auth.info.codeSent", { email: "x@y.z" })).toContain("x@y.z");
  });

  it("falls back to the key when missing", () => {
    const t = createTranslator("en");
    expect(t("nope.not.here")).toBe("nope.not.here");
  });
});

describe("locale policy", () => {
  it("is Arabic-first with an RTL default", () => {
    expect(APP_DEFAULT_LOCALE).toBe("ar");
    expect(resolveLocale(undefined)).toBe("ar");
    expect(directionFor("ar")).toBe("rtl");
    expect(directionFor("en")).toBe("ltr");
  });

  it("honors a valid cookie and ignores an invalid one", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("fr")).toBe("ar");
  });
});
