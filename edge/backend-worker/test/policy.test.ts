import { describe, expect, it } from "vitest";
import {
  CONTAINER_ENV_NAMES,
  ConfigurationError,
  containerEnv,
  instanceCount,
  instanceName,
  isBackendPath,
  serviceError,
} from "../src/policy";

describe("isBackendPath", () => {
  it("serves the FastAPI prefix and nothing else", () => {
    expect(isBackendPath("/api/backend")).toBe(true);
    expect(isBackendPath("/api/backend/health")).toBe(true);
    expect(isBackendPath("/api/backend/docs")).toBe(true);
    expect(isBackendPath("/api/backendx")).toBe(false);
    expect(isBackendPath("/api/other")).toBe(false);
    expect(isBackendPath("/")).toBe(false);
  });
});

describe("containerEnv", () => {
  const base = { APP_ENV: "staging", SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon" };

  it("copies only the allowlisted request-path variables", () => {
    const env = containerEnv({
      ...base,
      REDIS_CACHE_ENABLED: "true",
      REDIS_URL: "rediss://default:pw@redis.example:6379",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      DATABASE_URL: "postgres://postgres:pw@db/postgres",
      R2_SECRET_ACCESS_KEY: "r2-secret",
      R2_ACCESS_KEY_ID: "r2-id",
      BACKEND_CONTAINER: { idFromName() {} },
      SOMETHING_ELSE: "x",
    });
    expect(env).toEqual({ ...base, REDIS_CACHE_ENABLED: "true", REDIS_URL: "rediss://default:pw@redis.example:6379" });
  });

  it("never lists a privileged credential", () => {
    for (const name of CONTAINER_ENV_NAMES) {
      expect(name).not.toMatch(/SERVICE_ROLE|DATABASE_URL|^R2_|SECRET_ACCESS_KEY/);
    }
  });

  it("drops empty and non-string values", () => {
    expect(containerEnv({ ...base, REDIS_URL: "", OPENAI_API_KEY: 42 })).toEqual(base);
  });

  it("refuses to start without a known APP_ENV (never falls back to local)", () => {
    expect(() => containerEnv({ ...base, APP_ENV: undefined })).toThrow(ConfigurationError);
    expect(() => containerEnv({ ...base, APP_ENV: "" })).toThrow(ConfigurationError);
    expect(() => containerEnv({ ...base, APP_ENV: "prod" })).toThrow(ConfigurationError);
  });
});

describe("instance pool", () => {
  it("bounds the pool to 1..8 and defaults to 1", () => {
    expect(instanceCount(undefined)).toBe(1);
    expect(instanceCount("2")).toBe(2);
    expect(instanceCount("0")).toBe(1);
    expect(instanceCount("9")).toBe(1);
    expect(instanceCount("abc")).toBe(1);
  });

  it("names every instance in the pool and nothing outside it", () => {
    expect(instanceName(1, () => 0.99)).toBe("backend-0");
    expect(instanceName(2, () => 0)).toBe("backend-0");
    expect(instanceName(2, () => 0.5)).toBe("backend-1");
    expect(instanceName(2, () => 0.9999999)).toBe("backend-1");
    expect(instanceName(3, () => 1)).toBe("backend-2");
  });
});

describe("serviceError", () => {
  it("is JSON, uncached and free of internals", async () => {
    const res = serviceError(503, "unavailable");
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "unavailable", service: "backend" });
  });
});
