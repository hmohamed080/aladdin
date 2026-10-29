import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pure, no-network regression tests for the CURRENT identity projection.
 * These do not simulate successful OTP possession, modify Auth, or claim
 * that the future verification gate is implemented.
 *
 * Mainline PR #116 changes registration; this suite intentionally tests
 * only the stable read contract already on main.
 */
const db = vi.hoisted(() => ({
  currentUser: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: async () => ({ from: db.from, rpc: db.rpc }),
}));
vi.mock("@/server/auth/session", () => ({ getCurrentUser: db.currentUser }));
vi.mock("@/server/storage/edge-ticket", () => ({ readableMediaUrl: vi.fn() }));

import { loadMyIdentity } from "./profile-identity";
import { hasAppAccess } from "./registration";

const INSTALLER_ID = "11111111-1111-4111-8111-111111111111";
const SHOWROOM_ID = "22222222-2222-4222-8222-222222222222";
const NUMBER = "+201011112222";
const EXPIRES = "2026-11-05T10:00:00.000Z";

function profile(overrides: Record<string, unknown> = {}) {
  return {
    display_name: "Fixture User",
    display_name_confirmed_at: "2026-10-01T10:00:00.000Z",
    username: "fixtureuser",
    phone_country_iso2: "EG",
    phone_national: "1011112222",
    phone_e164: NUMBER,
    phone_verified_at: null,
    avatar_media_id: null,
    cover_media_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.currentUser.mockResolvedValue({
    id: INSTALLER_ID,
    email: "p201011112222@craftsman-login.aladdin.invalid",
  });
  db.from.mockImplementation((table: string) => {
    if (table !== "profiles") throw new Error(`unexpected read of ${table}`);
    return { select: db.select };
  });
  db.select.mockReturnValue({ eq: db.eq });
  db.eq.mockReturnValue({ maybeSingle: db.maybeSingle });
  db.maybeSingle.mockResolvedValue({ data: profile(), error: null });
  db.rpc.mockResolvedValue({ data: null, error: null });
});

describe("legacy phone identity — no OTP, no writes", () => {
  it("unverified legacy phone/password identity stays unverified and retains its login-key meaning", async () => {
    const identity = await loadMyIdentity();
    expect(identity).toMatchObject({
      phoneE164: NUMBER,
      phoneVerified: false,
      phoneIsLoginKey: true,
      phoneLogin: true,
      secondaryPhone: null,
    });
    expect(identity).not.toHaveProperty("email");
    expect(identity).not.toHaveProperty("userId");
    expect(db.eq).toHaveBeenCalledWith("user_id", INSTALLER_ID);
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith("my_secondary_phone");
  });

  it("a verified primary gets its status ONLY from phone_verified_at", async () => {
    db.maybeSingle.mockResolvedValueOnce({
      data: profile({ phone_verified_at: "2026-10-27T12:10:00.000Z" }),
      error: null,
    });
    expect((await loadMyIdentity())?.phoneVerified).toBe(true);
    expect(db.eq).toHaveBeenCalledWith("user_id", INSTALLER_ID);
  });

  it("an existing showroom phone/password alias is interpreted as a phone login without changing user identity", async () => {
    db.currentUser.mockResolvedValueOnce({
      id: SHOWROOM_ID,
      email: "p201011112222@craftsman-login.aladdin.invalid",
    });
    const identity = await loadMyIdentity();
    expect(identity).toMatchObject({ phoneVerified: false, phoneLogin: true, phoneIsLoginKey: true });
    expect(db.eq).toHaveBeenCalledWith("user_id", SHOWROOM_ID);
  });

  it("an email-signup account's unverified contact phone is NOT a phone login credential", async () => {
    db.currentUser.mockResolvedValueOnce({ id: SHOWROOM_ID, email: "owner@example.test" });
    const identity = await loadMyIdentity();
    expect(identity).toMatchObject({
      phoneE164: NUMBER,
      phoneVerified: false,
      phoneLogin: false,
      phoneIsLoginKey: false,
    });
  });

  it("active secondary reservation is separate from primary verification and grants no login or recovery metadata", async () => {
    db.rpc.mockResolvedValueOnce({
      data: {
        status: "active",
        phone: "+201066667777",
        expires_at: EXPIRES,
        can_renew: true,
        verified: false,
      },
      error: null,
    });
    const identity = await loadMyIdentity();
    expect(identity?.phoneVerified).toBe(false);
    expect(identity?.secondaryPhone).toEqual({
      phone: "+201066667777",
      expiresAt: EXPIRES,
      canRenew: true,
    });
    expect(identity?.secondaryPhone).not.toHaveProperty("loginEnabled");
    expect(identity?.secondaryPhone).not.toHaveProperty("recoveryEnabled");
    expect(identity?.secondaryPhone).not.toHaveProperty("verified");
  });

  it.each(["expired", "cancelled", "converted"])("does not expose a %s secondary reservation as active", async (status) => {
    db.rpc.mockResolvedValueOnce({
      data: { status, phone: "+201066667777", expires_at: EXPIRES, can_renew: false },
      error: null,
    });
    expect((await loadMyIdentity())?.secondaryPhone).toBeNull();
  });

  it("an unauthenticated request never reads a profile or secondary number", async () => {
    db.currentUser.mockResolvedValueOnce(null);
    expect(await loadMyIdentity()).toBeNull();
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("a missing profile does not invent an identity or a verification state", async () => {
    db.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await loadMyIdentity()).toBeNull();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("a failed primary profile read fails closed; it does not call the account verified", async () => {
    db.maybeSingle.mockResolvedValueOnce({ data: null, error: { code: "PGRST001" } });
    await expect(loadMyIdentity()).rejects.toEqual({ code: "PGRST001" });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("legacy app-access states do not infer phone verification from account type", () => {
    // Regression guard only: new phone signups will need an explicit,
    // server-enforced state gate. Never backfill or block legacy users here.
    expect(hasAppAccess("active_personal")).toBe(true);
    expect(hasAppAccess("access_ready")).toBe(true);
    for (const state of [
      "unverified", "consent_pending", "account_type_pending",
      "username_pending", "manually_blocked",
    ] as const) expect(hasAppAccess(state)).toBe(false);
  });
});
