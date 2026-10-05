import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  registration: "access_ready" as string,
  entries: [] as unknown[],
  data: null as unknown,
}));

class Redirect extends Error {
  constructor(public to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock("@/server/queries/registration", () => ({
  getRegistrationState: async () => state.registration,
  hasAppAccess: (s: string) => s === "access_ready" || s === "active_personal",
}));
vi.mock("@/server/queries/workspace", () => ({
  getWorkspaces: async () => ({ entries: state.entries }),
  personalEntry: (entries: Array<{ kind: string }>) => entries.find((e) => e.kind === "personal"),
}));
vi.mock("@/server/queries/onboarding", () => ({ getBusinessOnboardingData: async () => state.data }));
vi.mock("@/features/onboarding/business-flow", () => ({
  BusinessFlow: ({ presetOrgType, draftId }: { presetOrgType: string | null; draftId: string | null }) => (
    <div data-testid="business-flow">{`${presetOrgType ?? "none"}|${draftId ?? "nodraft"}`}</div>
  ),
}));

import AddBusinessPage from "./page";

const personal = (persona: string | null) => ({ kind: "personal", name: "P", persona });
const memberOf = { kind: "business", organizationId: "o1", name: "Nile", orgType: "showroom_dealer", relationship: "member" };
const ownerOf = (orgType: string) => ({ kind: "business", organizationId: "o2", name: "Mine", orgType, relationship: "owner" });
const onboarding = (over: Record<string, unknown> = {}) => ({
  selectedTrack: "professional",
  selectedAccountType: null,
  draftId: null,
  business: {},
  ...over,
});

async function visit() {
  try {
    const tree = await AddBusinessPage();
    return { redirectedTo: null as string | null, ...render(tree as React.ReactElement) };
  } catch (e) {
    if (e instanceof Redirect) return { redirectedTo: e.to };
    throw e;
  }
}

describe("/business/new — server-side entitlement (direct URL)", () => {
  beforeEach(() => {
    state.registration = "access_ready";
    state.entries = [personal(null)];
    state.data = onboarding();
  });

  it.each([
    ["installer_technician", "professional"],
    ["sales", "professional"],
    ["end_consumer", "consumer"],
    ["contractor", "professional"],
  ])("%s visiting directly cannot start a business", async (persona, selectedTrack) => {
    state.entries = [personal(persona)];
    state.data = onboarding({ selectedTrack, selectedAccountType: persona });
    const r = await visit();
    expect(r.redirectedTo).toBe("/home");
  });

  it("membership alone does not grant business creation", async () => {
    state.entries = [personal("end_consumer"), memberOf];
    state.data = onboarding({ selectedTrack: "consumer", selectedAccountType: "end_consumer" });
    expect((await visit()).redirectedTo).toBe("/home");
  });

  it("an engineer can use it", async () => {
    state.entries = [personal("engineer")];
    state.data = onboarding({ selectedAccountType: "engineer" });
    const r = await visit();
    expect(r.redirectedTo).toBeNull();
  });

  it("an eligible existing business owner can add another", async () => {
    state.entries = [ownerOf("importer")];
    const r = await visit();
    expect(r.redirectedTo).toBeNull();
  });

  it("a first business from an approved registration choice completes with no organization yet", async () => {
    state.entries = [];
    state.data = onboarding({ selectedTrack: "business", selectedAccountType: "showroom_dealer" });
    const r = await visit();
    expect(r.redirectedTo).toBeNull();
    // The registration type is carried in so the wizard never asks twice.
    expect((r as { container: HTMLElement }).container.textContent).toContain("showroom_dealer|nodraft");
  });

  it("an already-open draft can still be completed", async () => {
    state.entries = [personal("contractor")];
    state.data = onboarding({ draftId: "d-1" });
    const r = await visit();
    expect(r.redirectedTo).toBeNull();
    expect((r as { container: HTMLElement }).container.textContent).toContain("none|d-1");
  });

  it("an unverified caller is sent to sign in; one still mid-registration finishes that first", async () => {
    state.registration = "unverified";
    expect((await visit()).redirectedTo).toBe("/auth/sign-in");
    state.registration = "needs_consent";
    expect((await visit()).redirectedTo).toBe("/onboarding");
  });
});
