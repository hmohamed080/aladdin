import { describe, expect, it } from "vitest";
import {
  consumerCompleteness,
  professionalCompleteness,
  type CompletenessInput,
} from "./completeness";

const EMPTY: CompletenessInput = {
  displayName: null,
  phone: null,
  consumer: { intent: null, interests: [], governorate: null, city: null, budget: null },
  professional: {
    concreteType: null,
    headline: null,
    yearsExperience: null,
    specialization: null,
    bio: null,
    services: [],
    languages: [],
    availability: null,
    serviceAreas: [],
    offersRemote: false,
    governorate: null,
    city: null,
    maxTravelKm: null,
  },
};

const FULL_CONSUMER: CompletenessInput = {
  ...EMPTY,
  displayName: "Mona",
  phone: "01012345678",
  consumer: {
    intent: "planning",
    interests: ["flooring"],
    governorate: "cairo",
    city: "new_cairo",
    budget: "100_250k",
  },
};

const FULL_PROFESSIONAL: CompletenessInput = {
  ...EMPTY,
  displayName: "Omar",
  phone: "01012345678",
  professional: {
    concreteType: "engineer",
    headline: "Structural engineer",
    yearsExperience: 12,
    specialization: "structural",
    bio: "Twelve years on residential towers.",
    services: ["design_review"],
    languages: ["arabic"],
    availability: "within_week",
    serviceAreas: ["new_cairo"],
    offersRemote: false,
    governorate: "cairo",
    city: "new_cairo",
    maxTravelKm: 30,
  },
};

describe("consumerCompleteness", () => {
  it("is 0% with nothing filled in and lists every applicable item as missing", () => {
    const r = consumerCompleteness(EMPTY);
    expect(r).toMatchObject({ percent: 0, completed: 0, total: 6 });
    expect(r.missing).toEqual(["displayName", "phone", "intent", "interests", "location", "budget"]);
  });

  it("is 100% when every consumer item is present", () => {
    expect(consumerCompleteness(FULL_CONSUMER)).toMatchObject({
      percent: 100,
      completed: 6,
      total: 6,
      missing: [],
    });
  });

  it("rounds a partial score and reports only the outstanding items", () => {
    const r = consumerCompleteness({
      ...FULL_CONSUMER,
      consumer: { ...FULL_CONSUMER.consumer, budget: null, city: null },
    });
    // 4 of 6 → 66.67 → 67.
    expect(r).toMatchObject({ percent: 67, completed: 4, total: 6 });
    expect(r.missing).toEqual(["location", "budget"]);
  });

  it("treats a blank string as missing", () => {
    const r = consumerCompleteness({ ...FULL_CONSUMER, displayName: "   " });
    expect(r.missing).toEqual(["displayName"]);
  });

  it("needs BOTH governorate and city for the location item", () => {
    const r = consumerCompleteness({
      ...FULL_CONSUMER,
      consumer: { ...FULL_CONSUMER.consumer, city: null },
    });
    expect(r.missing).toEqual(["location"]);
  });
});

describe("professionalCompleteness", () => {
  it("is 0% with nothing filled in (travel radius is not yet applicable)", () => {
    const r = professionalCompleteness(EMPTY);
    expect(r).toMatchObject({ percent: 0, completed: 0, total: 12 });
    expect(r.missing).not.toContain("travelRadius");
  });

  it("is 100% for a fully described on-site professional", () => {
    expect(professionalCompleteness(FULL_PROFESSIONAL)).toMatchObject({
      percent: 100,
      completed: 13,
      total: 13,
      missing: [],
    });
  });

  it("drops the travel radius from the denominator for a remote-only professional", () => {
    const r = professionalCompleteness({
      ...FULL_PROFESSIONAL,
      professional: {
        ...FULL_PROFESSIONAL.professional,
        serviceAreas: [],
        offersRemote: true,
        maxTravelKm: null,
      },
    });
    expect(r).toMatchObject({ percent: 100, completed: 12, total: 12, missing: [] });
  });

  it("counts the service-area item as satisfied by remote consultation alone", () => {
    const r = professionalCompleteness({
      ...FULL_PROFESSIONAL,
      professional: { ...FULL_PROFESSIONAL.professional, serviceAreas: [], offersRemote: true },
    });
    expect(r.missing).not.toContain("serviceArea");
  });

  it("reports the outstanding items for a just-submitted profile", () => {
    const r = professionalCompleteness({
      ...FULL_PROFESSIONAL,
      professional: { ...FULL_PROFESSIONAL.professional, bio: null, languages: [], maxTravelKm: null },
    });
    expect(r.missing).toEqual(["bio", "languages", "travelRadius"]);
    expect(r).toMatchObject({ completed: 10, total: 13, percent: 77 });
  });

  it("counts zero years of experience as answered", () => {
    const r = professionalCompleteness({
      ...FULL_PROFESSIONAL,
      professional: { ...FULL_PROFESSIONAL.professional, yearsExperience: 0 },
    });
    expect(r.missing).toEqual([]);
  });

  it("never includes verification in the score", () => {
    // The input type has no verification field at all — the score cannot depend
    // on trust state, only on filled-in profile data.
    expect(Object.keys(FULL_PROFESSIONAL)).toEqual(["displayName", "phone", "consumer", "professional"]);
  });
});
