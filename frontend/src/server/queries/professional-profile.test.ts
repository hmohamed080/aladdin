import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const getUser = vi.fn();
const state: { row: unknown; error: unknown } = { row: null, error: null };
const asked = { from: [] as string[], select: [] as string[], eq: [] as [string, unknown][] };

vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: vi.fn(async () => {
    const builder: Record<string, unknown> = {
      auth: { getUser },
      from(t: string) {
        asked.from.push(t);
        return builder;
      },
      select(cols: string) {
        asked.select.push(cols);
        return builder;
      },
      eq(col: string, val: unknown) {
        asked.eq.push([col, val]);
        return builder;
      },
      maybeSingle: () => Promise.resolve({ data: state.row, error: state.error }),
    };
    return builder;
  }),
}));

import { isUuid, loadPublicProfile, loadProfilePublication } from "./professional-profile";

const ID = "0f6f4a8e-1c2b-4d3e-8a9f-2b1c3d4e5f60";

beforeEach(() => {
  state.row = null;
  state.error = null;
  asked.from.length = 0;
  asked.select.length = 0;
  asked.eq.length = 0;
  getUser.mockReset();
});

describe("isUuid", () => {
  it("accepts a uuid in either case", () => {
    expect(isUuid(ID)).toBe(true);
    expect(isUuid(ID.toUpperCase())).toBe(true);
  });

  it("rejects anything Postgres would refuse to compare", () => {
    for (const bad of ["", "abc", "../../etc/passwd", `${ID} or 1=1`, `${ID}x`]) {
      expect(isUuid(bad)).toBe(false);
    }
  });
});

/**
 * The public read. Its whole job is to answer with a profile or with NOTHING,
 * and the three ways of getting nothing must be indistinguishable — otherwise a
 * visitor who guesses an id learns that a private profile exists.
 */
describe("loadPublicProfile", () => {
  it("returns the approved projection columns, and only those", async () => {
    state.row = {
      id: ID,
      display_name: "Ahmed Mahmoud",
      headline: "Painting and finishing",
      bio: "Twelve years of interior finishing work.",
      languages: ["ar", "en"],
      persona: "installer_technician",
      specialization: "gypsum_paint",
      services: ["finishing"],
      years_experience: 12,
      service_areas: ["nasr_city"],
      available_for_work: true,
      availability_updated_at: "2026-08-28T10:00:00Z",
    };

    const profile = await loadPublicProfile(ID);

    expect(profile).toEqual({
      id: ID,
      displayName: "Ahmed Mahmoud",
      headline: "Painting and finishing",
      bio: "Twelve years of interior finishing work.",
      languages: ["ar", "en"],
      persona: "installer_technician",
      specialization: "gypsum_paint",
      services: ["finishing"],
      yearsExperience: 12,
      serviceAreas: ["nasr_city"],
      availableForWork: true,
      availabilityUpdatedAt: "2026-08-28T10:00:00Z",
    });
    // Read from the hardened projection, never the private base table.
    expect(asked.from).toEqual(["profile_public_directory"]);
    expect(asked.eq).toEqual([["id", ID]]);
  });

  it("never asks the database at all for a malformed id", async () => {
    expect(await loadPublicProfile("not-a-uuid")).toBeNull();
    expect(asked.from).toEqual([]);
  });

  it("is null for a profile the projection does not return", async () => {
    // One answer covers all three cases — absent, not listed, account inactive —
    // because the view already collapsed them into "no row".
    state.row = null;
    expect(await loadPublicProfile(ID)).toBeNull();
  });

  it("is null rather than a throw when the read errors", async () => {
    state.error = { message: "permission denied" };
    state.row = null;
    expect(await loadPublicProfile(ID)).toBeNull();
  });

  it("defaults every null array rather than leaking null into the view", async () => {
    // The LEFT-JOIN case, which is EVERY listed professional in the Pilot seed:
    // no onboarding row, so all four practice columns come back null.
    state.row = {
      id: ID,
      display_name: "Ahmed",
      headline: null,
      bio: null,
      languages: null,
      persona: "installer_technician",
      specialization: null,
      services: null,
      years_experience: null,
      service_areas: null,
    };
    const profile = await loadPublicProfile(ID);
    expect(profile?.languages).toEqual([]);
    expect(profile?.services).toEqual([]);
    expect(profile?.serviceAreas).toEqual([]);
    // A missing NUMBER stays null — an absent experience is not zero years.
    expect(profile?.yearsExperience).toBeNull();
    expect(profile?.specialization).toBeNull();
  });
});

/**
 * The caller's own publication state. `listed` must be true ONLY for the exact
 * server-controlled value — anything else is not published, and treating an
 * unrecognised status as published would put a private profile behind a link the
 * hub hands out.
 */
describe("loadProfilePublication", () => {
  it("is empty and does not query for a signed-out caller", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await loadProfilePublication()).toEqual({ profileId: null, listed: false });
    expect(asked.from).toEqual([]);
  });

  it("reports listed only for the listed status", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u-1" } } });
    state.row = { id: ID, public_profile_status: "listed" };
    expect(await loadProfilePublication()).toEqual({ profileId: ID, listed: true });
  });

  it("treats every other status — and an absent row — as not published", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u-1" } } });
    for (const status of ["hidden", "pending", "suppressed", null, undefined]) {
      state.row = { id: ID, public_profile_status: status };
      expect((await loadProfilePublication()).listed).toBe(false);
    }
    state.row = null;
    expect(await loadProfilePublication()).toEqual({ profileId: null, listed: false });
  });

  it("asks only about the caller's own profile row", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u-1" } } });
    state.row = { id: ID, public_profile_status: "listed" };
    await loadProfilePublication();
    expect(asked.from).toEqual(["profiles"]);
    expect(asked.eq).toEqual([["user_id", "u-1"]]);
  });
});
