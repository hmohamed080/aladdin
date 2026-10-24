import { afterEach, describe, expect, it, vi } from "vitest";
import { isBrand2026Path } from "./surface";

describe("isBrand2026Path", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("covers the workspace and the B2C seller area when the preview is on", () => {
    vi.stubEnv("NEXT_PUBLIC_MARKETPLACE_PREVIEW", "true");
    for (const p of ["/b2b", "/b2b/rfqs", "/b2c/seller", "/b2c/seller/products"]) {
      expect(isBrand2026Path(p)).toBe(true);
    }
  });

  it("leaves every other surface on the current design system", () => {
    vi.stubEnv("NEXT_PUBLIC_MARKETPLACE_PREVIEW", "true");
    for (const p of ["/", "/home", "/admin", "/auth/sign-in", "/marketplace", "/b2bx", "/b2c"]) {
      expect(isBrand2026Path(p)).toBe(false);
    }
  });

  it("is off everywhere when the preview flag is off", () => {
    vi.stubEnv("NEXT_PUBLIC_MARKETPLACE_PREVIEW", "false");
    expect(isBrand2026Path("/b2b")).toBe(false);
  });
});
