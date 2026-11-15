import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
let incoming: string | null = null;
let outsideRequest = false;
vi.mock("next/headers", () => ({
  headers: async () => {
    if (outsideRequest) throw new Error("outside a request scope");
    return new Headers(incoming ? { "x-view-as-context": incoming } : {});
  },
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));
const inner = { rpc: vi.fn(async () => ({ data: 1, error: null })), from: vi.fn(() => ({ select: () => ({}), insert: () => ({}) })), auth: { getUser: vi.fn(), signOut: vi.fn() }, storage: {} };
vi.mock("@supabase/ssr", () => ({ createServerClient: () => inner }));
vi.mock("@/lib/env", () => ({ readPublicEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", NEXT_PUBLIC_APP_ENV: "local" }) }));

const { assertNotViewAsContext, currentViewAsContext } = await import("./context");
const { getServerSupabase } = await import("@/lib/supabase/server");
const { ViewAsReadOnlyError } = await import("./read-only-client");

beforeEach(() => {
  incoming = null;
  outsideRequest = false;
  inner.rpc.mockClear();
});

describe("assertNotViewAsContext (boundary b: Server Action / route handler)", () => {
  it("passes for a normal request and outside a request scope", async () => {
    await expect(assertNotViewAsContext()).resolves.toBeUndefined();
    outsideRequest = true;
    await expect(assertNotViewAsContext()).resolves.toBeUndefined();
    expect(await currentViewAsContext()).toBeNull();
  });

  it("refuses when the trusted header marks a view request (either tree)", async () => {
    for (const v of ["exact", "interim"]) {
      incoming = v;
      await expect(assertNotViewAsContext()).rejects.toBeInstanceOf(ViewAsReadOnlyError);
    }
  });

  it("the sign-out action calls it first", () => {
    const src = readFileSync(path.resolve(__dirname, "../actions/auth.ts"), "utf8");
    expect(src).toMatch(/export async function signOut\(\): Promise<void> \{\s*await assertNotViewAsContext\(\);/);
  });
});

describe("getServerSupabase in view context", () => {
  it("is the untouched client for a normal request (the Admin's console is not affected)", async () => {
    const c = await getServerSupabase();
    expect(c).toBe(inner);
    await expect(c.rpc("admin_update_user" as never)).resolves.toBeTruthy();
  });

  it("is the default-deny wrapper in the exact tree: writes and unlisted RPCs are refused, readers work", async () => {
    incoming = "exact";
    const c = await getServerSupabase();
    expect(Object.is(c, inner)).toBe(false);
    expect(() => c.rpc("admin_update_user" as never)).toThrow(ViewAsReadOnlyError);
    expect(() => (c.from("t" as never) as never as { insert: () => void }).insert()).toThrow(ViewAsReadOnlyError);
    await c.rpc("admin_view_as_current" as never);
    expect(inner.rpc).toHaveBeenCalledTimes(1);
  });

  it("leaves the interim tree's client alone (its admin chrome needs its own loaders); the gate refuses its writes", async () => {
    incoming = "interim";
    expect(await getServerSupabase()).toBe(inner);
  });
});
