import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTranslator } from "@/lib/i18n/translate";
import { PublicProfileView } from "./public-profile";
import type { PublicProfile } from "@/server/queries/professional-profile";

const profile = (over: Partial<PublicProfile> = {}): PublicProfile => ({
  id: "0f6f4a8e-1c2b-4d3e-8a9f-2b1c3d4e5f60",
  displayName: "Ahmed Mahmoud",
  headline: "Painting and finishing",
  bio: "Twelve years of interior finishing work.",
  languages: ["ar", "en"],
  persona: "installer_technician",
  specialization: "gypsum_paint",
  services: ["finishing"],
  yearsExperience: 12,
  serviceAreas: ["nasr_city"],
  availableForWork: false,
  availabilityUpdatedAt: null,
  // No canonical trades by default: the seeded Pilot professionals had none
  // until Increment 5, so this is the state most existing profiles are in and
  // the one the legacy free-text fallback has to keep working for.
  tradeKeys: [],
  primaryTradeKey: null,
  ...over,
});

/** The common case in the Pilot today: listed, with no onboarding row behind it. */
const bare = (): PublicProfile =>
  profile({ specialization: null, services: [], yearsExperience: null, serviceAreas: [] });

/**
 * The public page. Two things are asserted and the second matters more: that it
 * renders what the projection exposes, and that it renders NOTHING the projection
 * does not — the reference pack shows a rating, a completed-job count, a points
 * total and call/message buttons on this exact screen, and none of them has a
 * model behind it.
 */
describe("PublicProfileView", () => {
  it("shows the approved fields in English", () => {
    render(<PublicProfileView profile={profile()} t={createTranslator("en")} locale="en" />);
    expect(screen.getByRole("heading", { level: 1, name: "Ahmed Mahmoud" })).toBeTruthy();
    expect(screen.getByText("Painting and finishing")).toBeTruthy();
    expect(screen.getByText(/Twelve years of interior finishing work/)).toBeTruthy();
    expect(screen.getByText("Installer / Technician")).toBeTruthy();
  });

  it("renders under the default Arabic locale", () => {
    render(<PublicProfileView profile={profile()} t={createTranslator("ar")} locale="ar" />);
    expect(screen.getByRole("heading", { level: 1, name: "Ahmed Mahmoud" })).toBeTruthy();
    // The persona label is localized, not the person's own text.
    expect(screen.queryByText("Installer / Technician")).toBeNull();
  });

  it("invents NOTHING the projection cannot supply", () => {
    const { container } = render(<PublicProfileView profile={profile()} t={createTranslator("en")} locale="en" />);
    const text = (container.textContent ?? "").toLowerCase();
    for (const unapproved of [
      "rating",
      "review",
      "completed job",
      "points",
      "match",
      // The reference puts a distance beside the service areas; there is no geo
      // model, so the areas are named and never measured.
      " km",
      "call",
      "message",
      "hire",
      "%",
    ]) {
      expect(text).not.toContain(unapproved);
    }
    // No contact affordance of any kind: the projection holds no phone or email.
    expect(container.querySelector("a[href^='tel:']")).toBeNull();
    expect(container.querySelector("a[href^='mailto:']")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
  });

  it("omits empty sections rather than printing an empty heading", () => {
    render(
      <PublicProfileView
        profile={profile({ bio: null, languages: [], headline: null })}
        t={createTranslator("en")}
        locale="en"
      />,
    );
    expect(screen.queryByRole("heading", { name: "About" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Languages" })).toBeNull();
    // The identity still renders — a sparse profile is still a real one.
    expect(screen.getByRole("heading", { level: 1, name: "Ahmed Mahmoud" })).toBeTruthy();
  });

  it("falls back to a neutral name rather than rendering a blank heading", () => {
    render(<PublicProfileView profile={profile({ displayName: null })} t={createTranslator("en")} locale="en" />);
    expect(screen.getByRole("heading", { level: 1, name: "Aladdin professional" })).toBeTruthy();
  });
});

/**
 * The practice fields `20260831090002` published. The negative case matters as
 * much as the positive one: the projection LEFT JOINs the onboarding row, so a
 * listed professional with none is normal — every one in the Pilot seed is —
 * and the page must stay coherent rather than printing four empty headings.
 */
describe("PublicProfileView — the practice", () => {
  it("shows specialization, experience, services and service areas", () => {
    render(<PublicProfileView profile={profile()} t={createTranslator("en")} locale="en" />);
    expect(screen.getByRole("heading", { name: "Work and specialties" })).toBeTruthy();
    expect(screen.getByText("Gypsum & paint")).toBeTruthy();
    expect(screen.getByText("12 years")).toBeTruthy();
    expect(screen.getByText("Finishing")).toBeTruthy();
    expect(screen.getByText("Nasr City")).toBeTruthy();
  });

  it("localizes every practice value rather than printing its stored key", () => {
    const { container } = render(<PublicProfileView profile={profile()} t={createTranslator("en")} locale="en" />);
    const text = container.textContent ?? "";
    // `createTranslator` returns the KEY PATH when a message is missing, so any
    // dotted namespace surviving into the rendered page is an unlocalized value
    // reaching the public. Asserting the paths rather than the individual keys is
    // deliberate: taxonomy keys like `finishing` are also ordinary English words
    // that legitimately appear in a professional's own headline and summary.
    for (const namespace of ["onboarding.", "personalHome.", "profile.", "accountType."]) {
      expect(text).not.toContain(namespace);
    }
  });

  it("labels a language stored as an ISO code, not just the onboarding vocabulary", () => {
    // Every listed professional in the Pilot seed stores `ar`/`en`, while the
    // onboarding flow writes `arabic`/`english`. A page that knew only one
    // convention printed a raw key path at the other — on a PUBLIC page.
    render(<PublicProfileView profile={profile({ languages: ["ar", "en"] })} t={createTranslator("en")} locale="en" />);
    expect(screen.getByText("Arabic")).toBeTruthy();
    expect(screen.getByText("English")).toBeTruthy();
  });

  it("labels the onboarding vocabulary too", () => {
    render(
      <PublicProfileView profile={profile({ languages: ["arabic", "french"] })} t={createTranslator("en")} locale="en" />,
    );
    expect(screen.getByText("Arabic")).toBeTruthy();
    expect(screen.getByText("French")).toBeTruthy();
  });

  it("renders the practice in Arabic too", () => {
    render(<PublicProfileView profile={profile()} t={createTranslator("ar")} locale="ar" />);
    expect(screen.getByRole("heading", { name: "العمل والتخصصات" })).toBeTruthy();
    expect(screen.queryByText("Gypsum & paint")).toBeNull();
  });

  it("omits the whole section when the professional has no onboarding row", () => {
    render(<PublicProfileView profile={bare()} t={createTranslator("en")} locale="en" />);
    expect(screen.queryByRole("heading", { name: "Work and specialties" })).toBeNull();
    // The profile is still a real one — identity and summary survive.
    expect(screen.getByRole("heading", { level: 1, name: "Ahmed Mahmoud" })).toBeTruthy();
    expect(screen.getByText(/Twelve years of interior finishing work/)).toBeTruthy();
  });

  it("renders each practice field independently of the others", () => {
    // Only years of experience — the section appears, with nothing else in it.
    render(
      <PublicProfileView
        profile={profile({ specialization: null, services: [], serviceAreas: [] })}
        t={createTranslator("en")}
        locale="en"
      />,
    );
    expect(screen.getByRole("heading", { name: "Work and specialties" })).toBeTruthy();
    expect(screen.getByText("12 years")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Core services" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Service areas" })).toBeNull();
  });
  /* ---------------------------------------------------------------------- */
  /* Availability (Increment 4, §8.4)                                       */
  /* ---------------------------------------------------------------------- */

  it("shows availability WITH its age, because neither is useful alone", () => {
    // The visitor is deciding whether to make contact. "Available, set eight
    // months ago" is a different fact from "available, set this morning", and the
    // page's job is to give them both and stop there.
    render(
      <PublicProfileView
        profile={profile({
          availableForWork: true,
          availabilityUpdatedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        })}
        t={createTranslator("en")}
        locale="en"
      />,
    );
    expect(screen.getByText("Available for work")).toBeTruthy();
    expect(screen.getByTestId("availability-age").textContent).toMatch(/^Updated /);
  });

  it("shows an UNAVAILABLE professional rather than hiding them (O3)", () => {
    // Availability filters nothing. Hiding an unavailable professional would be
    // the platform deciding that "not right now" means "not at all" — the exact
    // inference O3 refuses to make on their behalf.
    render(
      <PublicProfileView
        profile={profile({ availableForWork: false, availabilityUpdatedAt: new Date().toISOString() })}
        t={createTranslator("en")}
        locale="en"
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Ahmed Mahmoud" })).toBeTruthy();
    expect(screen.getByText("Not taking work")).toBeTruthy();
  });

  it("distinguishes NEVER SET from unavailable", () => {
    render(<PublicProfileView profile={profile()} t={createTranslator("en")} locale="en" />);
    expect(screen.getByTestId("availability-age").textContent).toBe("Not set yet");
  });

  it("renders availability in Arabic, the default locale", () => {
    render(
      <PublicProfileView
        profile={profile({
          availableForWork: true,
          availabilityUpdatedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        })}
        t={createTranslator("ar")}
        locale="ar"
      />,
    );
    expect(screen.getByText("متاح للعمل")).toBeTruthy();
    const age = screen.getByTestId("availability-age").textContent ?? "";
    expect(age).toMatch(/آخر تحديث/);
    expect(age).not.toMatch(/[0-9]/);
  });

  /**
   * The canonical taxonomy on the public page (Increment 5, §4.6).
   *
   * This is the surface the whole taxonomy exists for: a visitor deciding
   * whether to make contact is scanning for the CATEGORY, and until now they got
   * either a sentence, a vocabulary key, or — for every seeded professional —
   * nothing at all.
   */
  it("leads with the canonical trades and marks the primary", () => {
    render(
      <PublicProfileView
        profile={profile({ tradeKeys: ["marble_granite", "tiling"], primaryTradeKey: "marble_granite" })}
        t={createTranslator("en")}
        locale="en"
      />,
    );
    expect(screen.getByTestId("public-trades")).toBeTruthy();
    expect(screen.getByText("Marble & granite")).toBeTruthy();
    expect(screen.getByText("Tiling")).toBeTruthy();
  });

  /**
   * ONE SPECIALTY SIGNAL, NOT TWO. The fixture carries `gypsum_paint` in the
   * legacy free-text column AND a canonical trade; showing both would print the
   * same kind of fact twice with nothing to distinguish them.
   */
  it("does not print the legacy specialization beside a canonical trade", () => {
    render(
      <PublicProfileView
        profile={profile({ tradeKeys: ["marble_granite"], primaryTradeKey: "marble_granite" })}
        t={createTranslator("en")}
        locale="en"
      />,
    );
    expect(screen.queryByText("Gypsum & paint")).toBeNull();
  });

  it("keeps the legacy specialization where there is no trade to replace it", () => {
    render(<PublicProfileView profile={profile()} t={createTranslator("en")} locale="en" />);
    expect(screen.getByText("Gypsum & paint")).toBeTruthy();
  });

  /**
   * THE LATENT DEFECT THIS INCREMENT FOUND. `prof_specialization` holds a
   * vocabulary key in some rows and free PROSE in every seeded and staging one,
   * and the page used to render it straight through the catalog — so a stranger
   * reading Sayed's public profile saw
   * `onboarding.professional.specializations.Marble and granite fixing`.
   */
  it("renders a prose specialization as prose, never as a message path", () => {
    const { container } = render(
      <PublicProfileView
        profile={profile({ specialization: "Marble and granite fixing" })}
        t={createTranslator("en")}
        locale="en"
      />,
    );
    expect(screen.getByText("Marble and granite fixing")).toBeTruthy();
    expect(container.textContent).not.toMatch(/onboarding\./);
  });

  it("shows canonical trades in Arabic with no raw key", () => {
    const { container } = render(
      <PublicProfileView
        profile={profile({ tradeKeys: ["marble_granite", "tiling"], primaryTradeKey: "marble_granite" })}
        t={createTranslator("ar")}
        locale="ar"
      />,
    );
    expect(screen.getByText("رخام وجرانيت")).toBeTruthy();
    expect(container.textContent).not.toMatch(/marble_granite|tiling|onboarding\./);
  });

  it("stays a complete page for a professional who has declared no trade", () => {
    // The COMMON case: every seeded Pilot professional was in it until this
    // increment, and declaring a trade is optional — nothing is hidden or
    // filtered for the absence (O5).
    render(<PublicProfileView profile={profile()} t={createTranslator("en")} locale="en" />);
    expect(screen.queryByTestId("public-trades")).toBeNull();
    expect(screen.getByTestId("public-profile")).toBeTruthy();
  });

  it("still exposes no PRIVATE lead-time preference", () => {
    // `individual_onboarding.prof_availability` (within a week / within a month /
    // flexible) is a different fact from the live flag and is not in the
    // projection. Publishing a one-off onboarding answer as though it were a
    // current claim is the confusion this assertion exists to catch.
    const { container } = render(
      <PublicProfileView profile={profile({ availableForWork: true })} t={createTranslator("en")} locale="en" />,
    );
    const text = (container.textContent ?? "").toLowerCase();
    for (const leaked of ["within a week", "within a month", "flexible", "how soon"]) {
      expect(text).not.toContain(leaked);
    }
  });
});
