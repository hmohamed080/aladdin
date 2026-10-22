import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { changeUsername, USERNAME_CODES } from "./username-change";

const getUser = vi.fn();
const rpc = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
const client = { auth: { getUser }, rpc, from } as unknown as SupabaseClient<Database>;

const USER = { id: "11111111-1111-4111-8111-111111111111" };

beforeEach(() => {
  for (const fn of [getUser, rpc, maybeSingle, eq, select, from]) fn.mockClear();
  getUser.mockResolvedValue({ data: { user: USER } });
  rpc.mockResolvedValue({ error: null });
  maybeSingle.mockResolvedValue({ data: { username: "ahmed.m" }, error: null });
});

describe("changeUsername", () => {
  it("renames through profile_set_username with ONLY the username (no user id can be supplied) and returns the stored value", async () => {
    expect(await changeUsername(client, "ahmed.m")).toEqual({ ok: true, username: "ahmed.m" });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("profile_set_username", { p_username: "ahmed.m" });
    expect(from).toHaveBeenCalledWith("profiles");
    expect(eq).toHaveBeenCalledWith("user_id", USER.id); // read-back is the SESSION's own row
  });

  it("reports the spelling the database stored, not the spelling that was typed", async () => {
    maybeSingle.mockResolvedValue({ data: { username: "Ahmed.M" }, error: null });
    expect(await changeUsername(client, "ahmed.m")).toEqual({ ok: true, username: "Ahmed.M" });
  });

  it("trims the input", async () => {
    await changeUsername(client, "  ahmed.m \n");
    expect(rpc).toHaveBeenCalledWith("profile_set_username", { p_username: "ahmed.m" });
  });

  it.each([[undefined], [null], [42], [{}], [""], ["   "]])("requires a username (%j) before touching the session or the database", async (value) => {
    expect(await changeUsername(client, value)).toEqual({ ok: false, code: USERNAME_CODES.required });
    expect(getUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([["ab"], ["x".repeat(25)], ["9lives"], ["_ahmed"], ["ahmed_"], ["a..b"], ["a b"], ["ahmed!"], ["أحمد_محمود"], ["a".repeat(3) + "\u0000"]])(
    "rejects the malformed %j with the shape message before any database call",
    async (value) => {
      expect(await changeUsername(client, value)).toEqual({ ok: false, code: USERNAME_CODES.shape });
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("accepts the boundary lengths and the interior separators the database allows", async () => {
    for (const ok of ["abc", "a".repeat(24), "a.b", "a_b", "a1.b2_c3"]) {
      rpc.mockClear();
      maybeSingle.mockResolvedValue({ data: { username: ok }, error: null });
      expect(await changeUsername(client, ok)).toEqual({ ok: true, username: ok });
    }
  });

  it("an unauthenticated request changes nothing", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await changeUsername(client, "ahmed.m")).toEqual({ ok: false, code: USERNAME_CODES.sessionExpired });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["23505", USERNAME_CODES.unavailable], // reserved AND taken share this code - one answer for both
    ["22023", USERNAME_CODES.shape],
    ["42501", USERNAME_CODES.sessionExpired],
    ["XX000", USERNAME_CODES.failed],
    [undefined, USERNAME_CODES.failed],
  ])("maps database code %s to a translation key and claims no success", async (code, expected) => {
    rpc.mockResolvedValue({ error: { code, message: "relation profiles violates uq_profiles_username_normalized secret detail" } });
    const result = await changeUsername(client, "ahmed.m");
    expect(result).toEqual({ ok: false, code: expected });
    expect(JSON.stringify(result)).not.toMatch(/uq_profiles|violates|secret/); // never a database message
    expect(from).not.toHaveBeenCalled();
  });

  it("does not claim success when the stored value cannot be read back", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect(await changeUsername(client, "ahmed.m")).toEqual({ ok: false, code: USERNAME_CODES.failed });
    maybeSingle.mockResolvedValue({ data: { username: null }, error: null });
    expect(await changeUsername(client, "ahmed.m")).toEqual({ ok: false, code: USERNAME_CODES.failed });
  });
});
