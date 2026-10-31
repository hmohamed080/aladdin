import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getService: vi.fn(),
  currentUser: vi.fn(),
  start: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.1" }) }));
vi.mock("@/server/auth/session", () => ({ getCurrentUser: h.currentUser }));
vi.mock("@/server/phone-verification/runtime", () => ({ getPhoneVerificationService: h.getService }));

import { startPrimaryPhoneVerification, verifyPrimaryPhone } from "./phone-verification";

const USER = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  h.getService.mockReturnValue({ start: h.start, verify: h.verify });
  h.currentUser.mockResolvedValue({ id: USER });
  h.start.mockResolvedValue({ status: "sent", challengeId: "c", expiresAt: "e", resendAvailableAt: "r" });
  h.verify.mockResolvedValue({ status: "verified" });
});

describe("phone verification actions", () => {
  it("flag OFF (no service): unavailable, and the session is not even read", async () => {
    h.getService.mockReturnValue(null);
    expect(await startPrimaryPhoneVerification()).toEqual({ status: "unavailable" });
    expect(await verifyPrimaryPhone("c", "123456")).toEqual({ status: "unavailable" });
    expect(h.currentUser).not.toHaveBeenCalled();
  });

  it("no session: unavailable and the service is never called", async () => {
    h.currentUser.mockResolvedValue(null);
    expect(await startPrimaryPhoneVerification()).toEqual({ status: "unavailable" });
    expect(await verifyPrimaryPhone("c", "123456")).toEqual({ status: "unavailable" });
    expect(h.start).not.toHaveBeenCalled();
    expect(h.verify).not.toHaveBeenCalled();
  });

  it("always acts for the session user and uses the edge-provided address, never a client X-Forwarded-For", async () => {
    await startPrimaryPhoneVerification();
    await verifyPrimaryPhone("c", "123456");
    expect(h.start).toHaveBeenCalledWith(USER, "203.0.113.9");
    expect(h.verify).toHaveBeenCalledWith(USER, "c", "123456", "203.0.113.9");
  });

  it("accepts no user id, phone or verified flag from the caller (arity)", () => {
    expect(startPrimaryPhoneVerification.length).toBe(0);
    expect(verifyPrimaryPhone.length).toBe(2);
  });

  it("any thrown error becomes a bare 'unavailable' with no detail", async () => {
    h.start.mockRejectedValue(new Error("db down at +201000000001"));
    const out = await startPrimaryPhoneVerification();
    expect(out).toEqual({ status: "unavailable" });
    expect(JSON.stringify(out)).not.toContain("+2010");
  });
});
