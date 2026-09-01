import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { createTranslator } from "@/lib/i18n/translate";
import type { PersonalHomeData } from "@/server/queries/personal-home";
import { ProfessionalHome } from "./professional-home";

const data = (over: Partial<PersonalHomeData> = {}): PersonalHomeData => ({
  variant: "professional",
  displayName: "Sayed Abdel-Rahman",
  accountType: "installer_technician",
  isSalesperson: false,
  phone: null,
  completeness: { percent: 100, completed: 8, total: 8, missing: [] },
  verification: { state: "verified", reason: null, decidedAt: null },
  availability: { available: false, updatedAt: null },
  consumer: { intent: null, interests: [], governorate: null, city: null, budget: null },
  professional: {
    concreteType: "installer_technician",
    headline: "Marble and granite fixing",
    yearsExperience: 18,
    // The LEGACY free-text column, holding the convention the onboarding chips
    // write. Every seeded and staging professional holds prose here instead.
    specialization: "gypsum_paint",
    bio: null,
    services: [],
    additionalServices: [],
    languages: ["ar"],
    availability: "within_week",
    serviceAreas: [],
    offersRemote: false,
    governorate: null,
    city: null,
    maxTravelKm: null,
  },
  sales: null,
  ...over,
});

const noTrades = { keys: [], primaryKey: null };

/**
 * The dashboard's specialty row after the canonical taxonomy (Increment 5, §9).
 *
 * NO NEW CARD. The taxonomy reaches this page through the row that was already
 * there, because a dashboard card that exists only to say "you have declared
 * trades" would be a card about the platform's own data model rather than about
 * the person's work.
 */
describe("ProfessionalHome", () => {
  it("shows the canonical PRIMARY trade in the existing specialty row", () => {
    renderWithI18n(
      <ProfessionalHome
        data={data()}
        trades={{ keys: ["marble_granite", "tiling"], primaryKey: "marble_granite" }}
        t={createTranslator("en")}
      />,
      "en",
    );
    expect(screen.getByText("Marble & granite")).toBeTruthy();
  });

  /**
   * The canonical trade and the free text are ONE CLAIM in two vocabularies, and
   * only one of them is authority. Printing both would put two different
   * specialties in one card with nothing to say which the platform uses.
   */
  it("does not also print the legacy free-text specialty", () => {
    renderWithI18n(
      <ProfessionalHome
        data={data()}
        trades={{ keys: ["marble_granite"], primaryKey: "marble_granite" }}
        t={createTranslator("en")}
      />,
      "en",
    );
    expect(screen.queryByText("Gypsum & paint")).toBeNull();
  });

  it("falls back to the legacy value for an account that has not declared a trade", () => {
    // Every professional was in this state before Increment 5, and the page must
    // read exactly as it did — nothing was deleted, and nothing is required.
    renderWithI18n(
      <ProfessionalHome data={data()} trades={noTrades} t={createTranslator("en")} />,
      "en",
    );
    expect(screen.getByText("Gypsum & paint")).toBeTruthy();
  });

  /**
   * The prose case, which is what the seeded and staging installers actually
   * hold. Rendering it through the message catalog printed the key PATH.
   */
  it("renders a prose specialization as prose, never as a message path", () => {
    const { container } = renderWithI18n(
      <ProfessionalHome
        data={data({
          professional: { ...data().professional, specialization: "Marble and granite fixing" },
        })}
        trades={noTrades}
        t={createTranslator("en")}
      />,
      "en",
    );
    // Two matches, and both are correct: the headline says the same thing. The
    // point is that neither is a message path.
    expect(screen.getAllByText("Marble and granite fixing").length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/onboarding\./);
  });

  it("renders the canonical trade in Arabic with no raw key", () => {
    const { container } = renderWithI18n(
      <ProfessionalHome
        data={data()}
        trades={{ keys: ["marble_granite"], primaryKey: "marble_granite" }}
        t={createTranslator("ar")}
      />,
      "ar",
    );
    expect(screen.getByText("رخام وجرانيت")).toBeTruthy();
    expect(container.textContent).not.toMatch(/marble_granite|onboarding\./);
  });
});
