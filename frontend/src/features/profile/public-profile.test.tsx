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
    render(<PublicProfileView profile={profile()} t={createTranslator("en")} />);
    expect(screen.getByRole("heading", { level: 1, name: "Ahmed Mahmoud" })).toBeTruthy();
    expect(screen.getByText("Painting and finishing")).toBeTruthy();
    expect(screen.getByText(/Twelve years of interior finishing work/)).toBeTruthy();
    expect(screen.getByText("Installer / Technician")).toBeTruthy();
  });

  it("renders under the default Arabic locale", () => {
    render(<PublicProfileView profile={profile()} t={createTranslator("ar")} />);
    expect(screen.getByRole("heading", { level: 1, name: "Ahmed Mahmoud" })).toBeTruthy();
    // The persona label is localized, not the person's own text.
    expect(screen.queryByText("Installer / Technician")).toBeNull();
  });

  it("invents NOTHING the projection cannot supply", () => {
    const { container } = render(<PublicProfileView profile={profile()} t={createTranslator("en")} />);
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
      />,
    );
    expect(screen.queryByRole("heading", { name: "About" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Languages" })).toBeNull();
    // The identity still renders — a sparse profile is still a real one.
    expect(screen.getByRole("heading", { level: 1, name: "Ahmed Mahmoud" })).toBeTruthy();
  });

  it("falls back to a neutral name rather than rendering a blank heading", () => {
    render(<PublicProfileView profile={profile({ displayName: null })} t={createTranslator("en")} />);
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
    render(<PublicProfileView profile={profile()} t={createTranslator("en")} />);
    expect(screen.getByRole("heading", { name: "Work and specialties" })).toBeTruthy();
    expect(screen.getByText("Gypsum & paint")).toBeTruthy();
    expect(screen.getByText("12 years")).toBeTruthy();
    expect(screen.getByText("Finishing")).toBeTruthy();
    expect(screen.getByText("Nasr City")).toBeTruthy();
  });

  it("localizes every practice value rather than printing its stored key", () => {
    const { container } = render(<PublicProfileView profile={profile()} t={createTranslator("en")} />);
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
    render(<PublicProfileView profile={profile({ languages: ["ar", "en"] })} t={createTranslator("en")} />);
    expect(screen.getByText("Arabic")).toBeTruthy();
    expect(screen.getByText("English")).toBeTruthy();
  });

  it("labels the onboarding vocabulary too", () => {
    render(
      <PublicProfileView profile={profile({ languages: ["arabic", "french"] })} t={createTranslator("en")} />,
    );
    expect(screen.getByText("Arabic")).toBeTruthy();
    expect(screen.getByText("French")).toBeTruthy();
  });

  it("renders the practice in Arabic too", () => {
    render(<PublicProfileView profile={profile()} t={createTranslator("ar")} />);
    expect(screen.getByRole("heading", { name: "العمل والتخصصات" })).toBeTruthy();
    expect(screen.queryByText("Gypsum & paint")).toBeNull();
  });

  it("omits the whole section when the professional has no onboarding row", () => {
    render(<PublicProfileView profile={bare()} t={createTranslator("en")} />);
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
      />,
    );
    expect(screen.getByRole("heading", { name: "Work and specialties" })).toBeTruthy();
    expect(screen.getByText("12 years")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Core services" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Service areas" })).toBeNull();
  });
});
