import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

const notFound = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ notFound, redirect }));

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(async () => ({ rpc })) }));

const loadAdminAccess = vi.fn();
vi.mock("@/server/authorization/admin", () => ({ loadAdminAccess }));

const { parseViewAsSession, requireViewAs } = await import("./guard");

const ID = "70000009-0000-4000-8000-000000000009";
const future = () => new Date(Date.now() + 20 * 60_000).toISOString();
const payload = (over: Record<string, unknown> = {}) => ({
  session_id: "s1",
  kind: "craftsman",
  subject_user_id: ID,
  started_at: new Date().toISOString(),
  expires_at: future(),
  subject_name: "Ahmed",
  ...over,
});
const staff = (permissions: string[]) => ({ isStaff: true, rank: 80, permissions, roles: [] });

beforeEach(() => {
  rpc.mockReset();
  notFound.mockClear();
  redirect.mockClear();
  loadAdminAccess.mockReset();
  vi.stubEnv("ADMIN_VIEW_AS_ENABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());

describe("parseViewAsSession", () => {
  it("accepts a complete, unexpired craftsman session", () => {
    expect(parseViewAsSession(payload())).toMatchObject({ sessionId: "s1", kind: "craftsman", subjectUserId: ID, subjectName: "Ahmed" });
  });
  it.each([
    ["null", null],
    ["a string", "x"],
    ["an unknown kind", payload({ kind: "showroom" })],
    ["no session id", payload({ session_id: "" })],
    ["an expired window", payload({ expires_at: new Date(Date.now() - 1000).toISOString() })],
    ["a malformed expiry", payload({ expires_at: "soon" })],
  ])("treats %s as no session", (_n, raw) => {
    expect(parseViewAsSession(raw)).toBeNull();
  });
});

describe("requireViewAs — fails closed with one 404", () => {
  it("returns the live session for an authorized admin, READING it (never opening one)", async () => {
    loadAdminAccess.mockResolvedValue(staff(["users.view_as"]));
    rpc.mockResolvedValue({ data: payload(), error: null });
    const s = await requireViewAs(ID);
    expect(s.subjectUserId).toBe(ID);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("admin_view_as_current", { p_subject: ID, p_kind: "craftsman" });
    expect(rpc).not.toHaveBeenCalledWith("admin_view_as_begin", expect.anything());
  });

  it("404s when the feature is switched off, before any database call", async () => {
    vi.stubEnv("ADMIN_VIEW_AS_ENABLED", "false");
    await expect(requireViewAs(ID)).rejects.toThrow("NOT_FOUND");
    expect(loadAdminAccess).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("404s a malformed id before any database call", async () => {
    await expect(requireViewAs("../../etc")).rejects.toThrow("NOT_FOUND");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("404s staff without users.view_as (Support, Moderator) without calling begin", async () => {
    loadAdminAccess.mockResolvedValue(staff(["users.read", "users.verify"]));
    await expect(requireViewAs(ID)).rejects.toThrow("NOT_FOUND");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("404s a non-staff caller", async () => {
    loadAdminAccess.mockResolvedValue({ isStaff: false, rank: 0, permissions: ["users.view_as"], roles: [] });
    await expect(requireViewAs(ID)).rejects.toThrow("NOT_FOUND");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends the admin back to the user page when there is no live session (never started, ended, expired, ineligible)", async () => {
    loadAdminAccess.mockResolvedValue(staff(["users.view_as"]));
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "not permitted" } });
    await expect(requireViewAs(ID)).rejects.toThrow(`REDIRECT:/admin/users/${ID}`);
  });

  it("does not trust a session payload for a DIFFERENT subject than the one requested", async () => {
    loadAdminAccess.mockResolvedValue(staff(["users.view_as"]));
    rpc.mockResolvedValue({ data: payload({ subject_user_id: "70000008-0000-4000-8000-000000000008" }), error: null });
    await expect(requireViewAs(ID)).rejects.toThrow(`REDIRECT:/admin/users/${ID}`);
  });
});
