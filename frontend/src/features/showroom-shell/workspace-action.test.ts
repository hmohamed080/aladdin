import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceEntry } from "@/lib/workspace/model";
const state = vi.hoisted(() => ({ registration: "access_ready", entries: [] as WorkspaceEntry[], set: vi.fn(), remove: vi.fn(), load: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: state.set, delete: state.remove }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({}) }));
vi.mock("@/server/queries/registration", () => ({ getRegistrationState: async () => state.registration, hasAppAccess: (value: string) => value === "access_ready" }));
vi.mock("@/server/queries/workspace", () => ({ loadWorkspaces: async () => { state.load(); return { entries: state.entries }; } }));
import { selectShowroomWorkspace } from "./workspace-action";
const id = "12345678-1234-4123-8123-123456789012";
beforeEach(() => { vi.clearAllMocks(); state.registration = "access_ready"; state.entries = []; });
describe("showroom switch authority", () => {
  it.each(["invalid", "", "engineer", "Personal"])("rejects non-organization target %s", async (value) => {
    expect(await selectShowroomWorkspace(value)).toEqual({ error: true });
    expect(state.load).not.toHaveBeenCalled();
    expect(state.set).not.toHaveBeenCalled();
  });
  it("rejects anonymous callers without resolving or changing context", async () => {
    state.registration = "unverified";
    expect(await selectShowroomWorkspace(id)).toEqual({ error: true });
    expect(state.load).not.toHaveBeenCalled();
    expect(state.set).not.toHaveBeenCalled();
  });
  it("rejects another tenant or a revoked membership absent from my_workspaces", async () => {
    expect(await selectShowroomWorkspace(id)).toEqual({ error: true });
    expect(state.set).not.toHaveBeenCalled();
    expect(state.remove).not.toHaveBeenCalled();
  });
  it.each(["showroom_dealer", "supplier", "manufacturer", "importer", "design_office"])("switches an actual %s membership and clears branch context", async (orgType) => {
    state.entries = [{ kind: "business", organizationId: id, name: "Business", orgType, relationship: "member" }];
    await expect(selectShowroomWorkspace(id)).rejects.toThrow("redirect:/showroom/home");
    expect(state.set).toHaveBeenCalledWith("aladdin-org", id, expect.objectContaining({ path: "/", sameSite: "lax" }));
    expect(state.remove).toHaveBeenCalledWith("aladdin-branch");
  });
  it("rejects Personal for a business-only identity that has no Personal workspace", async () => {
    state.entries = [{ kind: "business", organizationId: id, name: "Business", orgType: "showroom_dealer", relationship: "owner" }];
    expect(await selectShowroomWorkspace("personal")).toEqual({ error: true });
    expect(state.set).not.toHaveBeenCalled();
  });
  it("rejects Personal for an anonymous caller without resolving workspaces", async () => {
    state.registration = "unverified";
    expect(await selectShowroomWorkspace("personal")).toEqual({ error: true });
    expect(state.load).not.toHaveBeenCalled();
  });
  it("switches to the caller's real Personal workspace, clears branch context and lands on /home", async () => {
    state.entries = [
      { kind: "personal", name: "Ahmed", persona: "engineer" },
      { kind: "business", organizationId: id, name: "Business", orgType: "showroom_dealer", relationship: "owner" },
    ];
    await expect(selectShowroomWorkspace("personal")).rejects.toThrow("redirect:/home");
    expect(state.set).toHaveBeenCalledWith("aladdin-org", "personal", expect.objectContaining({ path: "/", sameSite: "lax" }));
    expect(state.remove).toHaveBeenCalledWith("aladdin-branch");
  });
});
