import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

const signInWithOtp = vi.fn();
const verifyOtp = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: vi.fn(async () => ({ auth: { signInWithOtp, verifyOtp } })),
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

  it("sends a code for a valid email (passwordless, shouldCreateUser)", async () => {
    signInWithOtp.mockResolvedValueOnce({ error: null });
    const res = await requestEmailOtp({ ok: false }, fd({ email: "a-owner@example.test" }));
    expect(res.ok).toBe(true);
    expect(res.code).toBe("auth.info.codeSent");
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "a-owner@example.test",
      options: { shouldCreateUser: true },
    });
  });

  it("surfaces a send failure", async () => {
    signInWithOtp.mockResolvedValueOnce({ error: new Error("smtp") });
    const res = await requestEmailOtp({ ok: false }, fd({ email: "a-owner@example.test" }));
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
    await expect(
      verifyEmailOtp(
        { ok: false },
        fd({ email: "a-owner@example.test", token: "123456", next: "/b2b/leads" }),
      ),
    ).rejects.toThrow("REDIRECT:/b2b/leads");
  });

  it("ignores an unsafe next target (open-redirect guard)", async () => {
    verifyOtp.mockResolvedValueOnce({ error: null });
    await expect(
      verifyEmailOtp(
        { ok: false },
        fd({ email: "a-owner@example.test", token: "123456", next: "https://evil.example" }),
      ),
    ).rejects.toThrow("REDIRECT:/b2b");
  });

  it("surfaces a verification failure", async () => {
    verifyOtp.mockResolvedValueOnce({ error: new Error("bad code") });
    const res = await verifyEmailOtp({ ok: false }, fd({ email: "a-owner@example.test", token: "000000" }));
    expect(res.code).toBe("auth.error.verifyFailed");
  });
});
