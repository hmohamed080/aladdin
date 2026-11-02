import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({ redirect: (path: string) => redirect(path) }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(async () => ({ rpc })) }));
vi.mock("@/server/auth/session", () => ({ readSessionIdentity: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/server/queries/landing", () => ({ resolveActiveLanding: vi.fn(async () => "/home") }));

import { saveAccountBasics } from "./account-basics";

type Basics = { phone: string | null; governorate: string | null; city: string | null; cityCustom: string | null; specialtyKind?: string; specialties: string[] };
const NOTHING: Basics = { phone: null, governorate: null, city: null, cityCustom: null, specialtyKind: "trades", specialties: [] };

function withBasics(basics: Basics, writes: Record<string, { error: unknown }> = {}) {
  rpc.mockImplementation(async (name: string) => (name === "my_account_basics" ? { data: basics, error: null } : (writes[name] ?? { error: null })));
}

function form(fields: Record<string, string | string[]>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const value of [v].flat()) fd.append(k, value);
  return fd;
}

beforeEach(() => {
  rpc.mockReset();
  redirect.mockClear();
});

describe("saveAccountBasics", () => {
  it("saves phone, location and specialties, then lands", async () => {
    withBasics(NOTHING);
    await expect(
      saveAccountBasics({ ok: false }, form({ phone: "01012345678", phoneCountry: "EG", governorate: "cairo", city: "new-cairo", specialties: ["wallpaper_installation", "door_installation"] })),
    ).rejects.toThrow("REDIRECT:/home");
    expect(rpc).toHaveBeenCalledWith("profile_set_phone", { p_country_iso2: "EG", p_national: "1012345678", p_e164: "+201012345678" });
    expect(rpc).toHaveBeenCalledWith("account_basics_set", {
      p_governorate: "cairo",
      p_city: "new-cairo",
      p_city_custom: null,
      p_specialties: ["wallpaper_installation", "door_installation"],
    });
  });

  it("only writes what is missing — an existing phone and location are never touched", async () => {
    withBasics({ ...NOTHING, phone: "+201000000000", governorate: "giza", city: "dokki" });
    await expect(saveAccountBasics({ ok: false }, form({ phone: "01099999999", governorate: "cairo", city: "maadi", specialties: "wallpaper_installation" }))).rejects.toThrow("REDIRECT:/home");
    expect(rpc).not.toHaveBeenCalledWith("profile_set_phone", expect.anything());
    expect(rpc).toHaveBeenCalledWith("account_basics_set", { p_governorate: null, p_city: null, p_city_custom: null, p_specialties: ["wallpaper_installation"] });
  });

  it("refuses a missing or invalid phone, a missing town and no specialty, before writing anything", async () => {
    withBasics(NOTHING);
    expect(await saveAccountBasics({ ok: false }, form({ governorate: "cairo", city: "maadi", specialties: "x" }))).toMatchObject({ field: "phone", code: "accountBasics.error.phoneRequired" });
    expect(await saveAccountBasics({ ok: false }, form({ phone: "12", governorate: "cairo", city: "maadi", specialties: "x" }))).toMatchObject({ field: "phone", code: "accountBasics.error.phoneInvalid" });
    expect(await saveAccountBasics({ ok: false }, form({ phone: "01012345678", governorate: "cairo", specialties: "x" }))).toMatchObject({ field: "location" });
    expect(await saveAccountBasics({ ok: false }, form({ phone: "01012345678", governorate: "cairo", city: "maadi" }))).toMatchObject({ field: "specialties", code: "accountBasics.error.specialtiesRequired" });
    expect(rpc).not.toHaveBeenCalledWith("profile_set_phone", expect.anything());
    expect(rpc).not.toHaveBeenCalledWith("account_basics_set", expect.anything());
  });

  it("keeps a typed town, and names a phone already used by another account", async () => {
    withBasics({ ...NOTHING, specialties: ["painting"] }, { profile_set_phone: { error: { code: "23505" } } });
    expect(await saveAccountBasics({ ok: false }, form({ phone: "01012345678", governorate: "giza", city: "", cityCustom: "Kafr Testtown" }))).toMatchObject({
      field: "phone",
      code: "accountBasics.error.phoneTaken",
    });
    withBasics({ ...NOTHING, phone: "+201000000000", specialties: ["painting"] });
    await expect(saveAccountBasics({ ok: false }, form({ governorate: "giza", city: "", cityCustom: "Kafr Testtown" }))).rejects.toThrow("REDIRECT:/home");
    expect(rpc).toHaveBeenCalledWith("account_basics_set", { p_governorate: "giza", p_city: null, p_city_custom: "Kafr Testtown", p_specialties: null });
  });

  it("keeps a safe next on the landing surface and drops anything else", async () => {
    withBasics({ ...NOTHING, phone: "+201000000000", governorate: "giza", city: "dokki" });
    await expect(saveAccountBasics({ ok: false }, form({ specialties: "painting", next: "/home/jobs" }))).rejects.toThrow("REDIRECT:/home/jobs");
    await expect(saveAccountBasics({ ok: false }, form({ specialties: "painting", next: "https://evil.example" }))).rejects.toThrow("REDIRECT:/home");
  });
});
