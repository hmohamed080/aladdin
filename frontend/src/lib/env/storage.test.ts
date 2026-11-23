import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { legacyStorageWritesOpen, storageEnvSchema } from "./storage";
describe("server-only R2 settings", () => {
  it("defaults write routing off and accepts documented empty placeholders", () => {
    expect(storageEnvSchema.parse({ R2_ACCOUNT_ID: "", R2_PRIVATE_BUCKET: "" }).R2_STORAGE_ENABLED).toBe(false);
  });
  it("fails closed when enabled without credentials", () => {
    expect(() => storageEnvSchema.parse({ R2_STORAGE_ENABLED: "true" })).toThrow();
  });
  it("rejects shared public/private buckets and malformed account IDs", () => {
    expect(() => storageEnvSchema.parse({ R2_PUBLIC_BUCKET: "x", R2_PRIVATE_BUCKET: "x" })).toThrow();
    expect(() => storageEnvSchema.parse({ R2_ACCOUNT_ID: "https://attacker.example" })).toThrow();
  });
  it("allows a local S3 stand-in endpoint only in local", () => {
    expect(storageEnvSchema.parse({ R2_LOCAL_S3_ENDPOINT: "http://127.0.0.1:8333", APP_ENV: "local" }).R2_LOCAL_S3_ENDPOINT).toBe("http://127.0.0.1:8333");
    expect(() => storageEnvSchema.parse({ R2_LOCAL_S3_ENDPOINT: "http://127.0.0.1:8333", APP_ENV: "production" })).toThrow();
  });
  it("keeps legacy Supabase writes open by default, and closes them with R2 routing or explicitly", () => {
    const parse = (v: Record<string, string>) => storageEnvSchema.parse({ R2_ACCOUNT_ID: "a".repeat(32), R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_PRIVATE_BUCKET: "b", SUPABASE_SERVICE_ROLE_KEY: "x", ...v });
    expect(legacyStorageWritesOpen(parse({}))).toBe(true);
    expect(legacyStorageWritesOpen(parse({ MEDIA_LEGACY_STORAGE_WRITES: "false" }))).toBe(false);
    expect(legacyStorageWritesOpen(parse({ R2_STORAGE_ENABLED: "true" }))).toBe(false);
    expect(legacyStorageWritesOpen(parse({ R2_STORAGE_ENABLED: "true", MEDIA_LEGACY_STORAGE_WRITES: "true" }))).toBe(false);
  });
  it("keeps the site-media bucket apart from user media", () => {
    expect(() => storageEnvSchema.parse({ R2_SITE_BUCKET: "x", R2_PRIVATE_BUCKET: "x" })).toThrow();
    expect(() => storageEnvSchema.parse({ R2_SITE_BUCKET: "x", R2_PUBLIC_BUCKET: "x" })).toThrow();
    expect(storageEnvSchema.parse({ R2_SITE_BUCKET: "site", R2_PRIVATE_BUCKET: "priv" }).R2_SITE_BUCKET).toBe("site");
  });
});
