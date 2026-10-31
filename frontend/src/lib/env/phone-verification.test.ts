import { describe, expect, it } from "vitest";
import { parsePhoneVerificationEnv } from "./phone-verification";

describe("phone verification env", () => {
  it("is OFF by default and for anything but the literal 'true'", () => {
    expect(parsePhoneVerificationEnv({}).enabled).toBe(false);
    expect(parsePhoneVerificationEnv({ PHONE_VERIFICATION_ENABLED: "false" }).enabled).toBe(false);
    expect(parsePhoneVerificationEnv({ PHONE_VERIFICATION_ENABLED: "true" }).enabled).toBe(true);
  });
  it("signup verification needs BOTH switches and is OFF by default", () => {
    expect(parsePhoneVerificationEnv({}).signupEnabled).toBe(false);
    expect(parsePhoneVerificationEnv({ PHONE_SIGNUP_VERIFICATION_ENABLED: "true" }).signupEnabled).toBe(false);
    expect(parsePhoneVerificationEnv({ PHONE_VERIFICATION_ENABLED: "true" }).signupEnabled).toBe(false);
    expect(parsePhoneVerificationEnv({ PHONE_VERIFICATION_ENABLED: "true", PHONE_SIGNUP_VERIFICATION_ENABLED: "true" }).signupEnabled).toBe(true);
  });
  it("carries the delivery switch through raw (delivery.ts decides, fail-closed)", () => {
    expect(parsePhoneVerificationEnv({}).delivery).toBeUndefined();
    expect(parsePhoneVerificationEnv({ PHONE_OTP_DELIVERY: "outbox" }).delivery).toBe("outbox");
  });
  it("rejects values that are not exactly true/false instead of guessing", () => {
    for (const bad of ["TRUE", "1", "yes", "on", ""]) {
      expect(() => parsePhoneVerificationEnv({ PHONE_VERIFICATION_ENABLED: bad })).toThrow("Invalid phone verification environment");
    }
  });
  it("passes the key material through untouched and never echoes it in an error", () => {
    const keys = JSON.stringify({ current: "k1", keys: { k1: "A".repeat(44) } });
    expect(parsePhoneVerificationEnv({ PHONE_OTP_HMAC_KEYS: keys }).hmacKeys).toBe(keys);
    let message = "";
    try { parsePhoneVerificationEnv({ PHONE_OTP_HMAC_KEYS: "short" }); } catch (e) { message = (e as Error).message; }
    expect(message).toContain("PHONE_OTP_HMAC_KEYS");
    expect(message).not.toContain("short");
  });
});
