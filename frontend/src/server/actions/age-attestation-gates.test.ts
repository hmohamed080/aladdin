import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }) }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
const rpc = vi.fn();
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(async () => ({ rpc, auth: { getUser } })) }));

import { chooseAccountTypeAction, chooseUsernameAction } from "./registration";
import { selectAccountTypeAction } from "./onboarding";

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  rpc.mockResolvedValue({ data: null, error: null });
});

describe("finish-registration account type (OAuth / recovery): the point the account becomes access-ready", () => {
  it.each([[{}], [{ ageConfirmed: "" }], [{ ageConfirmed: "false" }], [{ ageConfirmed: "no" }]])("refuses %o with ageNotConfirmed and never touches the database", async (extra) => {
    const res = await chooseAccountTypeAction({ ok: false }, form({ accountType: "supplier", ...extra }));
    expect(res).toEqual({ ok: false, code: "authPasswordPreview.error.ageNotConfirmed" });
    expect(getUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("with ageConfirmed it applies the account type and continues", async () => {
    await expect(chooseAccountTypeAction({ ok: false }, form({ accountType: "supplier", ageConfirmed: "on" }))).rejects.toThrow("REDIRECT:/onboarding");
    expect(rpc).toHaveBeenCalledWith("onboarding_select_account_type", expect.objectContaining({ p_track: "business" }));
  });
});

describe("shared onboarding account type step", () => {
  it("refuses without ageConfirmed, before any validation of the choice or any database call", async () => {
    const res = await selectAccountTypeAction({ ok: false }, form({ choice: "supplier" }));
    expect(res.code).toBe("authPasswordPreview.error.ageNotConfirmed");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("with ageConfirmed it proceeds to the RPC", async () => {
    await expect(selectAccountTypeAction({ ok: false }, form({ choice: "supplier", ageConfirmed: "on" }))).rejects.toThrow("REDIRECT:/onboarding/complete");
    expect(rpc).toHaveBeenCalledWith("onboarding_select_account_type", expect.objectContaining({ p_track: "business" }));
  });
});

describe("chooseUsernameAction (inert since P1 PR-2)", () => {
  it("writes nothing and sends the person to the onboarding gate", async () => {
    await expect(chooseUsernameAction({ ok: false }, form({ username: "ahmed" }))).rejects.toThrow("REDIRECT:/onboarding");
    expect(rpc).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });
});
