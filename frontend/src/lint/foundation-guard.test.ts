import { describe, expect, it } from "vitest";
import {
  UNKNOWN_SEMANTIC_UTILITY,
  TAILWIND_PALETTE,
  ARBITRARY_COLOR,
  HEX,
} from "../../eslint/ui-foundation-guard.mjs";

/**
 * The fourth `aladdin/ui-foundation` check: a class that parses like a real
 * token (no hex, no `[...]`, no default-palette family) but names something
 * `tailwind.config.ts` never declared, so Tailwind emits no rule and the
 * element silently gets no colour — the `bg-surface-sunken` class of defect.
 *
 * These pin the regex's actual behaviour rather than the class names it was
 * first written against, because this session found the naive version both
 * under- and over-fired: `ring-offset-canvas` false-flagged as an unknown
 * `ring-*` colour, and — after that was fixed — a CSS property list inside
 * `transition-[border-color,box-shadow]` and an unrelated English sentence
 * containing "...to-next-level..." both false-flagged too, because a bare
 * `\b` boundary doesn't know a class boundary from a comma or a hyphen in
 * prose. Each false positive here is a real string pulled from `src/` during
 * that triage, not an invented example.
 */
const unknownUtility = new RegExp(UNKNOWN_SEMANTIC_UTILITY);

describe("UNKNOWN_SEMANTIC_UTILITY", () => {
  it("flags the historical defects it was written to catch", () => {
    for (const cls of ["bg-surface-sunken", "text-warning-fg", "border-line", "text-heading"]) {
      expect(unknownUtility.test(cls)).toBe(true);
    }
  });

  it("flags the doubled-prefix bugs this session found and fixed", () => {
    // `borderColor` only declares `DEFAULT` and `strong` (→ `border` /
    // `border-strong`); there is no `colors.border`, so `border-border` and
    // `border-border-strong` were both silently no-op classes in real files.
    expect(unknownUtility.test("border-border")).toBe(true);
    expect(unknownUtility.test("hover:border-border-strong")).toBe(true);
    // `border-strong` lives only in `borderColor`, never in the general
    // `colors` object, so `text-border-strong` cannot resolve either.
    expect(unknownUtility.test("mx-2 text-border-strong")).toBe(true);
  });

  it("does not flag a real compound token, or a real token that is a prefix of an unknown one", () => {
    expect(unknownUtility.test("bg-surface")).toBe(false);
    expect(unknownUtility.test("border-accent-solid/40")).toBe(false);
    expect(unknownUtility.test("border-strong")).toBe(false);
    expect(unknownUtility.test("bg-brand-basalt/10")).toBe(false);
  });

  it("does not flag ring-offset-*, a different utility family sharing the ring- substring", () => {
    expect(unknownUtility.test("focus-visible:ring-2 focus-visible:ring-offset-canvas")).toBe(false);
  });

  it("does not flag side-plus-width border compounds", () => {
    expect(unknownUtility.test("flex border-b last:border-b-0")).toBe(false);
    expect(unknownUtility.test("whitespace-nowrap border-b-2 px-3")).toBe(false);
    expect(unknownUtility.test("border-t-2")).toBe(false);
  });

  it("does not flag transparent, white/black, or a gradient direction utility", () => {
    expect(unknownUtility.test("border-transparent bg-surface-2/60")).toBe(false);
    expect(unknownUtility.test("text-white/90")).toBe(false);
    expect(unknownUtility.test("bg-gradient-to-b from-shell-lit via-shell to-shell-deep")).toBe(false);
    expect(unknownUtility.test("bg-gradient-to-b from-transparent via-shell-gold to-transparent")).toBe(false);
  });

  it("does not flag a CSS property name inside a transition arbitrary value", () => {
    // "border-color" here is a property in a comma-separated list, not a
    // `border-{colour}` utility — it is never preceded by a class boundary.
    expect(
      unknownUtility.test("transition-[background-color,border-color,box-shadow,color] duration-fast"),
    ).toBe(false);
  });

  it("does not flag ordinary prose that happens to contain a prefix word mid-sentence", () => {
    expect(unknownUtility.test("derives and shows the real remaining-to-next-level amount")).toBe(false);
  });
});

describe("the other three ui-foundation checks still catch their original cases", () => {
  it("HEX matches a raw hex colour", () => {
    expect(new RegExp(HEX).test("#1a2b3c")).toBe(true);
  });

  it("ARBITRARY_COLOR matches a bracketed literal colour value", () => {
    expect(new RegExp(ARBITRARY_COLOR).test("bg-[#123456]")).toBe(true);
  });

  it("TAILWIND_PALETTE matches a default-palette colour", () => {
    expect(new RegExp(TAILWIND_PALETTE).test("bg-slate-500")).toBe(true);
  });
});
