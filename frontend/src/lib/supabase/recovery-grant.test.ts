import { describe, expect, it, beforeEach, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ORIGINAL_SECRET = process.env.AUTH_PASSWORD_PREVIEW_GRANT_SECRET;

describe("recovery grant encryption", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.AUTH_PASSWORD_PREVIEW_GRANT_SECRET = "a".repeat(32);
  });

  afterAll(() => {
    process.env.AUTH_PASSWORD_PREVIEW_GRANT_SECRET = ORIGINAL_SECRET;
  });

  it("round-trips a valid grant", async () => {
    const { encryptRecoveryGrant, decryptRecoveryGrant } = await import("./recovery-grant");
    const grant = { email: "a-owner@example.test", accessToken: "fake-access-token", refreshToken: "fake-refresh-token", exp: Date.now() + 60_000 };
    const token = encryptRecoveryGrant(grant);
    expect(decryptRecoveryGrant(token)).toEqual(grant);
  });

  it("produces an opaque token unrelated to the plaintext (never leaks the email/token by inspection)", async () => {
    const { encryptRecoveryGrant } = await import("./recovery-grant");
    const token = encryptRecoveryGrant({ email: "a-owner@example.test", accessToken: "secret-token-value", refreshToken: "fake-refresh-token", exp: Date.now() + 60_000 });
    expect(token).not.toContain("a-owner");
    expect(token).not.toContain("secret-token-value");
  });

  it("rejects a tampered token (AEAD tag mismatch)", async () => {
    const { encryptRecoveryGrant, decryptRecoveryGrant } = await import("./recovery-grant");
    const token = encryptRecoveryGrant({ email: "a-owner@example.test", accessToken: "t", refreshToken: "fake-refresh-token", exp: Date.now() + 60_000 });
    const tampered = token.slice(0, -4) + (token.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
    expect(decryptRecoveryGrant(tampered)).toBeNull();
  });

  it("rejects an expired grant even though the encryption itself is still valid", async () => {
    const { encryptRecoveryGrant, decryptRecoveryGrant } = await import("./recovery-grant");
    const token = encryptRecoveryGrant({ email: "a-owner@example.test", accessToken: "t", refreshToken: "fake-refresh-token", exp: Date.now() - 1000 });
    expect(decryptRecoveryGrant(token)).toBeNull();
  });

  it("rejects a token encrypted under a DIFFERENT secret (key confusion / cross-environment replay)", async () => {
    const { encryptRecoveryGrant } = await import("./recovery-grant");
    const token = encryptRecoveryGrant({ email: "a-owner@example.test", accessToken: "t", refreshToken: "fake-refresh-token", exp: Date.now() + 60_000 });

    vi.resetModules();
    process.env.AUTH_PASSWORD_PREVIEW_GRANT_SECRET = "b".repeat(32);
    const { decryptRecoveryGrant: decryptWithDifferentKey } = await import("./recovery-grant");
    expect(decryptWithDifferentKey(token)).toBeNull();
  });

  it("rejects undefined/garbage input without throwing", async () => {
    const { decryptRecoveryGrant } = await import("./recovery-grant");
    expect(decryptRecoveryGrant(undefined)).toBeNull();
    expect(decryptRecoveryGrant("not-a-real-token")).toBeNull();
    expect(decryptRecoveryGrant("")).toBeNull();
  });
});
