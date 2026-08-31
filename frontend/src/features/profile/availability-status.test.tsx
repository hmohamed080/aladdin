import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTranslator } from "@/lib/i18n/translate";
import { AvailabilityBadge, AvailabilityAge } from "./availability-status";

/**
 * How availability READS, in both languages.
 *
 * The three properties worth holding, in order of how quietly each would break:
 *
 *   1. "Never set" does not collapse into "unavailable". They are different
 *      statements — one is a claim the person made, the other is a default they
 *      never touched — and showing the second as the first has the platform
 *      speaking for them (O3, inverted).
 *   2. Arabic is the DEFAULT locale, so every state must be asserted in it, not
 *      just the English happy path.
 *   3. No key path ever reaches the screen. Increment 2 shipped a public page
 *      printing `onboarding.professional.languages.ar` verbatim to an audience
 *      that cannot tell whether the profile or the platform is broken.
 */
/** Three days before "now" at any point this test runs — the age is relative. */
const FIXED = new Date(Date.now() - 3 * 86_400_000).toISOString();

describe("AvailabilityBadge", () => {
  it("names both states in English", () => {
    const t = createTranslator("en");
    const { unmount } = render(<AvailabilityBadge available t={t} />);
    expect(screen.getByText("Available for work")).toBeTruthy();
    unmount();

    render(<AvailabilityBadge available={false} t={t} />);
    expect(screen.getByText("Not taking work")).toBeTruthy();
  });

  it("names both states in Arabic, the default locale", () => {
    const t = createTranslator("ar");
    const { unmount } = render(<AvailabilityBadge available t={t} />);
    expect(screen.getByText("متاح للعمل")).toBeTruthy();
    unmount();

    render(<AvailabilityBadge available={false} t={t} />);
    expect(screen.getByText("لا أقبل أعمالًا حاليًا")).toBeTruthy();
  });

  it("does NOT paint unavailable as an error", () => {
    // The load-bearing styling decision. Nothing is wrong with a professional who
    // is not taking work; a danger tone would editorialise about an honest answer
    // and push everyone toward leaving the flag on, which is how the signal dies.
    const { container } = render(
      <AvailabilityBadge available={false} t={createTranslator("en")} />,
    );
    expect(container.innerHTML).not.toMatch(/danger/);
  });

  it("marks available with a success tone", () => {
    const { container } = render(<AvailabilityBadge available t={createTranslator("en")} />);
    expect(container.innerHTML).toMatch(/success/);
  });

  it("never leaks a message key", () => {
    for (const locale of ["en", "ar"] as const) {
      for (const available of [true, false]) {
        const { container, unmount } = render(
          <AvailabilityBadge available={available} t={createTranslator(locale)} />,
        );
        expect(container.textContent).not.toMatch(/profile\./);
        unmount();
      }
    }
  });
});

describe("AvailabilityAge", () => {
  it("says NOT SET rather than dating a claim nobody made", () => {
    render(<AvailabilityAge updatedAt={null} locale="en" t={createTranslator("en")} />);
    expect(screen.getByTestId("availability-age").textContent).toBe("Not set yet");
  });

  it("says NOT SET in Arabic too", () => {
    render(<AvailabilityAge updatedAt={null} locale="ar" t={createTranslator("ar")} />);
    expect(screen.getByTestId("availability-age").textContent).toBe("لم يُحدَّد بعد");
  });

  it("dates a real change in English", () => {
    render(<AvailabilityAge updatedAt={FIXED} locale="en" t={createTranslator("en")} />);
    const text = screen.getByTestId("availability-age").textContent ?? "";
    expect(text.startsWith("Updated ")).toBe(true);
    // The age is INFORMATION, not a verdict: no threshold word may appear.
    expect(text.toLowerCase()).not.toMatch(/stale|expired|out of date|old/);
  });

  it("dates a real change in Arabic, with Arabic-Indic numerals", () => {
    render(<AvailabilityAge updatedAt={FIXED} locale="ar" t={createTranslator("ar")} />);
    const text = screen.getByTestId("availability-age").textContent ?? "";
    expect(text).toMatch(/آخر تحديث/);
    // `Intl.RelativeTimeFormat` is used precisely so Arabic gets its own numerals
    // and dual/plural forms; a Latin digit here means a `{count}` template crept
    // back in.
    expect(text).not.toMatch(/[0-9]/);
  });

  it("renders identically in both directions — no direction-specific branch", () => {
    // Everything in the status components is logical (gap, text-start), so RTL is
    // the mirror of LTR with no Arabic-only rule. The proof is that the same
    // locale produces the same markup under either `dir`, which is what makes the
    // page safe to flip.
    const t = createTranslator("en");
    const ltr = render(
      <div dir="ltr">
        <AvailabilityAge updatedAt={FIXED} locale="en" t={t} />
      </div>,
    );
    const ltrHtml = ltr.container.querySelector("[data-testid]")?.outerHTML;
    ltr.unmount();

    const rtl = render(
      <div dir="rtl">
        <AvailabilityAge updatedAt={FIXED} locale="en" t={t} />
      </div>,
    );
    expect(rtl.container.querySelector("[data-testid]")?.outerHTML).toBe(ltrHtml);
  });

  it("is stated relative to now, so it stays true as time passes", () => {
    // A formatted absolute date would freeze at render; the whole value of the
    // line is that it ages.
    const t = createTranslator("en");
    render(<AvailabilityAge updatedAt={new Date().toISOString()} locale="en" t={t} />);
    expect(screen.getByTestId("availability-age").textContent).toMatch(/Updated /);
  });
});
