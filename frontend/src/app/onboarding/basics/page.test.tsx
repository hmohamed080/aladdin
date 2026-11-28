import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({ redirect: (path: string) => redirect(path) }));
const state = vi.fn();
vi.mock("@/server/queries/registration", () => ({
  getRegistrationState: () => state(),
  hasAppAccess: (s: string) => s === "access_ready" || s === "active_personal",
}));
vi.mock("@/server/queries/landing", () => ({ activeLandingPath: vi.fn(async () => "/home") }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(async () => ({ rpc })) }));
const trades = vi.fn(async () => [{ key: "wallpaper_installation" }, { key: "door_installation" }]);
vi.mock("@/server/queries/trades", () => ({ loadTradeCatalog: () => trades() }));
const mandatory = vi.fn(async () => ({ required: false, orgType: null }));
vi.mock("@/server/queries/business-setup", () => ({ loadMandatoryBusinessSetup: () => mandatory() }));
vi.mock("@/features/onboarding/account-basics-form", () => ({ AccountBasicsForm: (props: unknown) => ({ props }) }));

import AccountBasicsPage from "./page";

const basics = (data: unknown) => rpc.mockResolvedValue({ data, error: null });
const page = (next?: string) => AccountBasicsPage({ searchParams: Promise.resolve({ next }) }) as Promise<{ props: Record<string, unknown> }>;

beforeEach(() => {
  rpc.mockReset();
  redirect.mockClear();
  trades.mockClear();
  state.mockResolvedValue("access_ready");
});

describe("/onboarding/basics", () => {
  it("shows only the missing sections, with the trade list when specialties are missing", async () => {
    basics({ phone: "+201012345678", governorate: null, city: null, cityCustom: null, specialtyKind: "trades", specialties: [] });
    const element = await page("/home/jobs");
    expect(element.props).toMatchObject({
      missing: { phone: false, location: true, specialties: true },
      source: { kind: "trades", keys: ["wallpaper_installation", "door_installation"] },
      next: "/home/jobs",
    });
  });

  it("does not load the trade list when specialties are already there", async () => {
    basics({ phone: null, governorate: "cairo", city: "maadi", cityCustom: null, specialtyKind: "trades", specialties: ["painting"] });
    const element = await page();
    expect(element.props.source).toBeNull();
    expect(trades).not.toHaveBeenCalled();
  });

  it("never asks a business account for specialties (its activity is asked in business setup)", async () => {
    basics({ phone: null, governorate: "cairo", city: "maadi", cityCustom: null, specialtyKind: "none", specialties: [] });
    const element = await page();
    expect(element.props).toMatchObject({ missing: { phone: true, location: false, specialties: false }, source: null });
  });

  it("sends a business registration to business setup instead", async () => {
    mandatory.mockResolvedValueOnce({ required: true, orgType: "showroom_dealer" } as never);
    await expect(page()).rejects.toThrow("REDIRECT:/onboarding/business");
  });

  it("sends a complete account straight on", async () => {
    basics({ phone: "+201012345678", governorate: "cairo", city: "maadi", cityCustom: null, specialties: ["painting"] });
    await expect(page()).rejects.toThrow("REDIRECT:/home");
  });

  it("fails open on a read error", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000" } });
    await expect(page()).rejects.toThrow("REDIRECT:/home");
  });

  it("keeps unverified and unfinished registrations out", async () => {
    state.mockResolvedValue("unverified");
    await expect(page()).rejects.toThrow("REDIRECT:/auth/sign-in");
    state.mockResolvedValue("needs_account_type");
    await expect(page()).rejects.toThrow("REDIRECT:/onboarding");
  });
});
