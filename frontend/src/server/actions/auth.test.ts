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
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: vi.fn(async () => ({ auth: { signInWithOtp, verifyOtp }, rpc })),
}));

import { requestEmailOtp, verifyEmailOtp } from "./auth";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => vi.clearAllMocks());

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

  it("redirects to a safe /b2b destination on success", async () => {
    verifyOtp.mockResolvedValueOnce({ error: null });
    // An explicit sub-path (not the bare workspace) is honoured as-is — the
    // onboarding resume gate only applies when heading to the default "/b2b".
    await expect(
      verifyEmailOtp(
        { ok: false },
        fd({ email: "a-owner@example.test", token: "123456", next: "/b2b/leads" }),
      ),
    ).rejects.toThrow("REDIRECT:/b2b/leads");
    expect(rpc).not.toHaveBeenCalled();
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
  });

  it("surfaces a verification failure", async () => {
    verifyOtp.mockResolvedValueOnce({ error: new Error("bad code") });
    const res = await verifyEmailOtp({ ok: false }, fd({ email: "a-owner@example.test", token: "000000" }));
    expect(res.code).toBe("auth.error.verifyFailed");
  });
});
