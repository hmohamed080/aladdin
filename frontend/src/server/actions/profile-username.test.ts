import { describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ auth: { getUser: vi.fn() }, rpc, from }) }));

import { setUsernameAction } from "./profile-identity";

describe("setUsernameAction (inert since P1 PR-2)", () => {
  it("never writes: no RPC, no table access, a safe generic failure", async () => {
    const fd = new FormData();
    fd.set("username", "ahmed.m");
    expect(await setUsernameAction({ ok: false }, fd)).toEqual({ ok: false, code: "profileIdentity.username.error" });
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
});
