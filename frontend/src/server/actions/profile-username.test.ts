import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const maybeSingle = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: async () => ({ auth: { getUser }, rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) }),
}));

import { setUsernameAction } from "./profile-identity";

const form = (username: unknown, extra: Record<string, string> = {}) => {
  const fd = new FormData();
  if (username !== undefined) fd.set("username", String(username));
  for (const [key, value] of Object.entries(extra)) fd.set(key, value);
  return fd;
};

describe("setUsernameAction", () => {
  beforeEach(() => {
    for (const fn of [getUser, rpc, maybeSingle, revalidatePath]) fn.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: "11111111-1111-4111-8111-111111111111" } } });
    rpc.mockResolvedValue({ error: null });
    maybeSingle.mockResolvedValue({ data: { username: "ahmed.m" }, error: null });
  });

  it("saves, returns the stored username and refreshes the pages that show it", async () => {
    expect(await setUsernameAction({ ok: false }, form("ahmed.m"))).toEqual({ ok: true, username: "ahmed.m" });
    expect(rpc).toHaveBeenCalledWith("profile_set_username", { p_username: "ahmed.m" });
    expect(revalidatePath).toHaveBeenCalledWith("/home/settings");
  });

  it("ignores any user id or other field in the request: only the session's account can be renamed", async () => {
    await setUsernameAction({ ok: false }, form("ahmed.m", { userId: "99999999-9999-4999-8999-999999999999", user_id: "99999999-9999-4999-8999-999999999999", p_user_id: "x" }));
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[0]).toEqual(["profile_set_username", { p_username: "ahmed.m" }]);
  });

  it("an unauthenticated request changes nothing and refreshes nothing", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await setUsernameAction({ ok: false }, form("ahmed.m"))).toEqual({ ok: false, code: "installerSecurity.error.sessionExpired" });
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("a refusal returns a translation key only and does not refresh", async () => {
    rpc.mockResolvedValue({ error: { code: "23505", message: "username is unavailable" } });
    expect(await setUsernameAction({ ok: false }, form("admin"))).toEqual({ ok: false, code: "registration.error.usernameUnavailable" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("a missing field is a validation error, not a call", async () => {
    expect(await setUsernameAction({ ok: false }, form(undefined))).toEqual({ ok: false, code: "registration.error.usernameRequired" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
