import { afterEach, describe, expect, it, vi } from "vitest";
import { isViewAsEnabled, viewAsEnvSchema } from "./view-as";

afterEach(() => vi.unstubAllEnvs());

describe("ADMIN_VIEW_AS_ENABLED", () => {
  it("is OFF by default", () => {
    expect(viewAsEnvSchema.parse({}).ADMIN_VIEW_AS_ENABLED).toBe(false);
    vi.stubEnv("ADMIN_VIEW_AS_ENABLED", "");
    expect(isViewAsEnabled()).toBe(false);
  });
  it("turns on only for the exact string true", () => {
    vi.stubEnv("ADMIN_VIEW_AS_ENABLED", "true");
    expect(isViewAsEnabled()).toBe(true);
    for (const v of ["1", "yes", "TRUE", "on"]) {
      vi.stubEnv("ADMIN_VIEW_AS_ENABLED", v);
      expect(isViewAsEnabled()).toBe(false);
    }
  });
});
