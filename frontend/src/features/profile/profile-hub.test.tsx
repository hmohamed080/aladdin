import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { createTranslator } from "@/lib/i18n/translate";
import type { PersonalHomeData } from "@/server/queries/personal-home";

vi.mock("@/server/actions/availability", () => ({
  setAvailabilityAction: async () => ({ ok: true }),
}));

import { ProfileHub } from "./profile-hub";

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
    specialization: "gypsum_paint",
    bio: null,
    services: ["finishing"],
    languages: ["ar"],
    // The PRIVATE lead-time preference — the field this increment had to stop
    // sharing a word with.
    availability: "within_week",
    serviceAreas: ["nasr_city"],
    offersRemote: false,
    governorate: "cairo",
    city: "nasr_city",
    maxTravelKm: 40,
    additionalServices: [],
  },
  sales: null,
  ...over,
});

const publication = { profileId: null, listed: false };

/**
 * The hub's wiring for availability.
 *
 * The assertion that earns its place is the LAST one. Before this increment the
 * hub had a row labelled "Availability" holding the one-off onboarding lead time.
 * Adding a live availability control to the same page would have put two
 * different facts under one word — and the failure is silent, because both render
 * perfectly. The label was changed; this pins it.
 */
describe("ProfileHub", () => {
  it("gives the professional a control for their own availability", () => {
    renderWithI18n(
      <ProfileHub data={data()} publication={publication} t={createTranslator("en")} />,
      "en",
    );
    expect(screen.getByRole("button", { name: "Mark me available" })).toBeTruthy();
  });

  it("keeps the live flag and the onboarding LEAD TIME as two different things", () => {
    renderWithI18n(
      <ProfileHub data={data()} publication={publication} t={createTranslator("en")} />,
      "en",
    );
    // The lead-time row is no longer called "Availability"…
    expect(screen.getByText("How soon you can start")).toBeTruthy();
    expect(screen.getByText("Within a week")).toBeTruthy();
    // …and the live state is stated in its own words, once.
    expect(screen.getByText("Not taking work")).toBeTruthy();
    expect(screen.queryByText("Availability")).toBeNull();
  });

  it("reflects an availability the person has already set", () => {
    renderWithI18n(
      <ProfileHub
        data={data({
          availability: {
            available: true,
            updatedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
          },
        })}
        publication={publication}
        t={createTranslator("en")}
      />,
      "en",
    );
    expect(screen.getByText("Available for work")).toBeTruthy();
    expect(screen.getByText(/^Updated /)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark me unavailable" })).toBeTruthy();
  });

  it("renders in Arabic with no key leak", () => {
    const { container } = renderWithI18n(
      <ProfileHub data={data()} publication={publication} t={createTranslator("ar")} />,
      "ar",
    );
    expect(screen.getByText("لا أقبل أعمالًا حاليًا")).toBeTruthy();
    expect(screen.getByText("متى يمكنك البدء")).toBeTruthy();
    expect(container.textContent).not.toMatch(/profile\.|onboarding\./);
  });
});
