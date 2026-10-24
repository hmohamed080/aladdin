import {beforeEach, describe, expect, it, vi} from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({data: null as unknown, error: null as unknown, filters: [] as [string, string][]}));
const client = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({getServerSupabase: client}));
import {publicProfileHref, publicRouteById, resolvePublicRoute} from "./public-profile-routes";
beforeEach(() => {
  state.data = null; state.error = null; state.filters = []; client.mockReset();
  const builder = {select: () => builder, eq: (key: string, value: string) => {state.filters.push([key,value]); return builder;}, maybeSingle: async () => ({data: state.data, error: state.error})};
  client.mockResolvedValue({from: (name: string) => {expect(name).toBe("profile_public_routes"); return builder;}});
});
describe("canonical public profile URLs", () => {
  it("resolves case-insensitive handles within the exact account type", async () => {
    state.data = {id:"123", persona:"engineer", username:"nadia.salem"};
    expect(await resolvePublicRoute("engineer", "Nadia.Salem")).toEqual(state.data);
    expect(state.filters).toEqual([["persona","engineer"],["username","nadia.salem"]]);
    expect(publicProfileHref({persona:"engineer", username:"nadia.salem"})).toBe("/p/engineer/nadia.salem");
  });
  it.each(["../secret", "nadia..salem", "a", "user@example.com", "a".repeat(25)])("rejects malformed handle %s before a query", async handle => {
    expect(await resolvePublicRoute("engineer", handle)).toBeNull(); expect(client).not.toHaveBeenCalled();
  });
  it("returns the same miss for unpublished, wrong-type, missing and failed lookups", async () => {
    expect(await resolvePublicRoute("installer_technician", "nadia.salem")).toBeNull();
    state.error = {message:"private error"};
    expect(await resolvePublicRoute("engineer", "nadia.salem")).toBeNull();
  });
  it("does not look up malformed legacy IDs", async () => {
    expect(await publicRouteById("not-a-uuid")).toBeNull(); expect(client).not.toHaveBeenCalled();
  });
});
