import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Result = { count?: number | null; error?: unknown };
type Call = { table: string; filters: Array<[string, unknown[]]> };
const state = vi.hoisted(() => ({ results: {} as Record<string, Result>, calls: [] as unknown[] }));

/** A chainable stand-in for the PostgREST builder: records the filters, resolves to the canned result for the table. */
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      const call: Call = { table, filters: [] };
      state.calls.push(call);
      const builder: Record<string, unknown> = {};
      for (const name of ["select", "in", "eq", "is"]) {
        builder[name] = (...args: unknown[]) => { call.filters.push([name, args]); return builder; };
      }
      builder.then = (resolve: (r: Result) => unknown) => resolve(state.results[table] ?? { count: 0 });
      return builder;
    },
  }),
}));
vi.mock("@/lib/env", () => ({ readPublicEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:63321" }), parseServerEnv: () => ({ SUPABASE_SERVICE_ROLE_KEY: "local-test-only" }) }));
import { countLandingPublicStats } from "./admin-server";

const calls = () => state.calls as Call[];

describe("countLandingPublicStats", () => {
  beforeEach(() => {
    state.calls = [];
    state.results = { users: { count: 1028 }, organizations: { count: 7 }, products: { count: 9 } };
  });

  it("counts every registered account (pending first sign-in or active), not only those who finished onboarding", async () => {
    expect(await countLandingPublicStats()).toEqual({ users: 1028, organizations: 7, products: 9 });
    const users = calls().find((c) => c.table === "users")!;
    expect(users.filters).toContainEqual(["in", ["status", ["pending_verification", "active"]]]);
    expect(users.filters).not.toContainEqual(["eq", ["status", "active"]]);
  });

  it("reads only the three public tables, never the staff or role tables the service role cannot read", async () => {
    await countLandingPublicStats();
    expect(calls().map((c) => c.table).sort()).toEqual(["organizations", "products", "users"]);
  });

  it("keeps counting businesses and products as before", async () => {
    await countLandingPublicStats();
    expect(calls().find((c) => c.table === "organizations")!.filters).toContainEqual(["eq", ["status", "active"]]);
    expect(calls().find((c) => c.table === "products")!.filters).toContainEqual(["eq", ["status", "published"]]);
  });

  it("fails (so the pills hide) on a database error or a missing count", async () => {
    state.results.users = { error: { message: "boom" } };
    await expect(countLandingPublicStats()).rejects.toThrow("landing stats unavailable");
    state.results.users = { count: null };
    await expect(countLandingPublicStats()).rejects.toThrow("landing stats unavailable");
  });
});
