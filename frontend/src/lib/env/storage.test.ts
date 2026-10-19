import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { storageEnvSchema } from "./storage";
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
});
