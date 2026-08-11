import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

const signInWithOtp = vi.fn();
const verifyOtp = vi.fn();
const rpc = vi.fn();
const { resolveActiveLanding } = vi.hoisted(() => ({ resolveActiveLanding: vi.fn() }));
const supabase = { auth: { signInWithOtp, verifyOtp }, rpc };
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: vi.fn(async () => supabase),
}));
vi.mock("@/server/queries/landing", () => ({
  resolveActiveLanding,
}));

import { requestEmailOtp, verifyEmailOtp } from "./auth";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveActiveLanding.mockResolvedValue("/b2b");
});

describe("requestEmailOtp", () => {
  it("rejects an invalid email without contacting Supabase", async () => {
    const res = await requestEmailOtp({ ok: false }, fd({ email: "nope" }));
    expect(res.ok).toBe(false);
    expect(res.code).toBe("auth.error.invalidEmail");
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("sends a code for a known pilot email as SIGN IN — never implicit sign-up", async () => {
    signInWithOtp.mockResolvedValueOnce({ error: null });
    const res = await requestEmailOtp({ ok: false }, fd({ email: "a-owner@example.test" }));
    expect(res.ok).toBe(true);
    expect(res.code).toBe("auth.info.codeSent");
    // The boundary: shouldCreateUser is false, so an unknown email can't register.
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "a-owner@example.test",
      options: { shouldCreateUser: false },
    });
  });

  it("does NOT create a user for an unknown email and stays enumeration-safe", async () => {
    // GoTrue refuses the send (signups disabled); we must show the SAME
    // "code sent" response and never register the identity.
    signInWithOtp.mockResolvedValueOnce({ error: { code: "otp_disabled", message: "Signups not allowed for otp" } });
    const res = await requestEmailOtp({ ok: false }, fd({ email: "stranger@example.test" }));
    expect(res.ok).toBe(true);
    expect(res.code).toBe("auth.info.codeSent");
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "stranger@example.test",
      options: { shouldCreateUser: false },
    });
  });

  it("never passes shouldCreateUser:true (sign in cannot become sign up)", async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    await requestEmailOtp({ ok: false }, fd({ email: "a-owner@example.test" }));
    for (const call of signInWithOtp.mock.calls) {
      expect(call[0]?.options?.shouldCreateUser).toBe(false);
    }
  });

  it("surfaces a genuine transient send failure", async () => {
    signInWithOtp.mockResolvedValueOnce({ error: { message: "smtp timeout" } });
    const res = await requestEmailOtp({ ok: false }, fd({ email: "a-owner@example.test" }));
    expect(res.ok).toBe(false);
    expect(res.code).toBe("auth.error.sendFailed");
  });
});

describe("verifyEmailOtp", () => {
  it("rejects a non-6-digit code", async () => {
    const res = await verifyEmailOtp({ ok: false }, fd({ email: "a-owner@example.test", token: "12" }));
    expect(res.code).toBe("auth.error.invalidCode");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("preserves a safe deep link within an active member's derived B2B surface", async () => {
    verifyOtp.mockResolvedValueOnce({ error: null });
    rpc.mockResolvedValueOnce({ data: "active_personal" });
    // A deep link is retained only after the caller's canonical surface resolves
    // to B2B.
    await expect(
      verifyEmailOtp(
        { ok: false },
        fd({ email: "a-owner@example.test", token: "123456", next: "/b2b/leads" }),
      ),
    ).rejects.toThrow("REDIRECT:/b2b/leads");
    expect(resolveActiveLanding).toHaveBeenCalledWith(supabase);
  });

  it("routes an active platform user through the canonical resolver to /admin", async () => {
    verifyOtp.mockResolvedValueOnce({ error: null });
    rpc.mockResolvedValueOnce({ data: "active_personal" });
    resolveActiveLanding.mockResolvedValueOnce("/admin");
    await expect(
      verifyEmailOtp(
        { ok: false },
        fd({ email: "admin@example.test", token: "123456", next: "/b2b" }),
      ),
    ).rejects.toThrow("REDIRECT:/admin");
  });

  it("routes an active organization-less consumer through the canonical resolver to /home", async () => {
    verifyOtp.mockResolvedValueOnce({ error: null });
    rpc.mockResolvedValueOnce({ data: "active_personal" });
    resolveActiveLanding.mockResolvedValueOnce("/home");
    await expect(
      verifyEmailOtp(
        { ok: false },
        fd({ email: "consumer@example.test", token: "123456", next: "/b2b" }),
      ),
    ).rejects.toThrow("REDIRECT:/home");
  });

  it("does not let a consumer retain a B2B deep link", async () => {
    verifyOtp.mockResolvedValueOnce({ error: null });
    rpc.mockResolvedValueOnce({ data: "active_personal" });
    resolveActiveLanding.mockResolvedValueOnce("/home");
    await expect(
      verifyEmailOtp(
        { ok: false },
        fd({ email: "consumer@example.test", token: "123456", next: "/b2b/leads" }),
      ),
    ).rejects.toThrow("REDIRECT:/home");
  });

  it("ignores an unsafe next target (open-redirect guard)", async () => {
    verifyOtp.mockResolvedValueOnce({ error: null });
    // Unsafe next → sanitized to "/b2b"; an ACTIVE member proceeds to the workspace.
    rpc.mockResolvedValueOnce({ data: "active_personal" });
    await expect(
      verifyEmailOtp(
        { ok: false },
        fd({ email: "a-owner@example.test", token: "123456", next: "https://evil.example" }),
      ),
    ).rejects.toThrow("REDIRECT:/b2b");
  });

  it("routes an incomplete-onboarding caller to /onboarding instead of the workspace", async () => {
    verifyOtp.mockResolvedValueOnce({ error: null });
    // Default "/b2b" destination + a non-active state → resume onboarding.
    rpc.mockResolvedValueOnce({ data: "contact_pending" });
    await expect(
      verifyEmailOtp({ ok: false }, fd({ email: "a-owner@example.test", token: "123456", next: "/b2b" })),
    ).rejects.toThrow("REDIRECT:/onboarding");
    expect(resolveActiveLanding).not.toHaveBeenCalled();
  });

  it("preserves an explicit invitation continuation without bypassing it", async () => {
    verifyOtp.mockResolvedValueOnce({ error: null });
    await expect(
      verifyEmailOtp(
        { ok: false },
        fd({
          email: "a-owner@example.test",
          token: "123456",
          next: "/auth/invite/pilotinvite000000000000000000nour01",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/auth/invite/pilotinvite000000000000000000nour01");
    expect(rpc).not.toHaveBeenCalled();
    expect(resolveActiveLanding).not.toHaveBeenCalled();
  });

  it("surfaces a verification failure", async () => {
    verifyOtp.mockResolvedValueOnce({ error: new Error("bad code") });
    const res = await verifyEmailOtp({ ok: false }, fd({ email: "a-owner@example.test", token: "000000" }));
    expect(res.code).toBe("auth.error.verifyFailed");
  });
});
