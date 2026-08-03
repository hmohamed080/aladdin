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
