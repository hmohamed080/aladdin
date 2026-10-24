import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ rpc: state.rpc }) }));

import { saveLegalNameAction, setBranchLocationAction } from "./organization-profile";
import { saveOrganizationContactAction } from "./contacts";

const ORG = "9c000000-cccc-4ccc-8ccc-000000000001";
const BRANCH = "9c000000-bbbb-4bbb-8bbb-000000000001";
const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  state.rpc.mockResolvedValue({ data: null, error: null });
});

describe("saveLegalNameAction", () => {
  it("trims, sends the name to the RPC and refreshes both settings pages", async () => {
    state.rpc.mockResolvedValue({ data: "Alpha Trading Co.", error: null });
    const res = await saveLegalNameAction(ORG, "  Alpha Trading Co.  ");
    expect(res).toEqual({ ok: true, value: "Alpha Trading Co." });
    expect(state.rpc).toHaveBeenCalledWith("organization_legal_name_set", { p_org_id: ORG, p_legal_name: "Alpha Trading Co." });
    expect(state.revalidate).toHaveBeenCalledWith("/showroom/settings");
    expect(state.revalidate).toHaveBeenCalledWith("/b2b/settings");
  });

  it("refuses a too-short or too-long name before any round trip", async () => {
    expect(await saveLegalNameAction(ORG, " a ")).toEqual({ ok: false, code: "invalid" });
    expect(await saveLegalNameAction(ORG, "x".repeat(121))).toEqual({ ok: false, code: "invalid" });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("tells a verified organization apart from a missing permission", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "42501", hint: "identity_change_requires_review", message: "x" } });
    expect(await saveLegalNameAction(ORG, "Alpha Trading Co.")).toEqual({ ok: false, code: "locked" });
    state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "org.manage required" } });
    expect(await saveLegalNameAction(ORG, "Alpha Trading Co.")).toEqual({ ok: false, code: "forbidden" });
    state.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    expect(await saveLegalNameAction(ORG, "Alpha Trading Co.")).toEqual({ ok: false, code: "failed" });
  });
});

describe("setBranchLocationAction", () => {
  it("sends the canonical governorate and a catalogue city", async () => {
    const res = await setBranchLocationAction({ ok: false }, form({ branchId: BRANCH, governorate: "cairo", city: "maadi" }));
    expect(res).toEqual({ ok: true, code: "settings.branchUpdated" });
    expect(state.rpc).toHaveBeenCalledWith("branch_location_set", {
      p_branch_id: BRANCH,
      p_governorate: "cairo",
      p_city: "maadi",
      p_city_custom: "",
    });
  });

  it("sends a typed city through the custom field and never as a catalogue city", async () => {
    await setBranchLocationAction({ ok: false }, form({ branchId: BRANCH, governorate: "giza", city: "", cityCustom: "Hay El Gamaa" }));
    expect(state.rpc).toHaveBeenCalledWith("branch_location_set", {
      p_branch_id: BRANCH,
      p_governorate: "giza",
      p_city: "",
      p_city_custom: "Hay El Gamaa",
    });
  });

  it("rejects an unknown governorate, a missing city and a city of another governorate before any round trip", async () => {
    expect((await setBranchLocationAction({ ok: false }, form({ branchId: BRANCH, governorate: "atlantis", city: "x" }))).code).toBe("onboarding.error.locationInvalid");
    expect((await setBranchLocationAction({ ok: false }, form({ branchId: BRANCH, governorate: "cairo" }))).code).toBe("onboarding.error.cityRequired");
    expect((await setBranchLocationAction({ ok: false }, form({ branchId: BRANCH, governorate: "giza", city: "maadi" }))).code).toBe("onboarding.error.locationInvalid");
    expect((await setBranchLocationAction({ ok: false }, form({ governorate: "cairo", city: "maadi" }))).ok).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("maps a database refusal to a stable key", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "branch.manage required" } });
    const res = await setBranchLocationAction({ ok: false }, form({ branchId: BRANCH, governorate: "cairo", city: "maadi" }));
    expect(res).toEqual({ ok: false, code: "settings.errors.denied" });
  });
});

describe("saveOrganizationContactAction (registered contact)", () => {
  it("keeps the registered phone and e-mail and refreshes both settings pages", async () => {
    const res = await saveOrganizationContactAction({ ok: false }, form({ orgId: ORG, phone: "+201012345678", email: "owner@shop.example", showEmail: "on" }));
    expect(res).toEqual({ ok: true });
    expect(state.rpc).toHaveBeenCalledWith("organization_contact_set", expect.objectContaining({ p_phone_e164: "+201012345678", p_contact_email: "owner@shop.example", p_show_email: true }));
    expect(state.revalidate).toHaveBeenCalledWith("/showroom/settings");
    expect(state.revalidate).toHaveBeenCalledWith("/b2b/settings");
  });

  it("gives a specific message for a bad number or e-mail, and for the database refusing the phone", async () => {
    expect((await saveOrganizationContactAction({ ok: false }, form({ orgId: ORG, phone: "abc" }))).code).toBe("onboarding.error.showroomPhoneRequired");
    expect((await saveOrganizationContactAction({ ok: false }, form({ orgId: ORG, email: "nope" }))).code).toBe("onboarding.error.contactInvalid");
    state.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "a showroom needs a business phone" } });
    expect((await saveOrganizationContactAction({ ok: false }, form({ orgId: ORG, email: "a@b.co" }))).code).toBe("onboarding.error.showroomPhoneRequired");
  });
});
