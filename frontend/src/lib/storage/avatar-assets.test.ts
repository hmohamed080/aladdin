import { describe, expect, it } from "vitest";
import { validateAvatarFile } from "./avatar-assets";

describe("validateAvatarFile", () => {
  it("accepts JPEG, PNG and WebP", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(validateAvatarFile({ type, size: 1000 })).toEqual({ ok: true });
    }
  });

  it("refuses other types, SVG included (scriptable, never sanitized here)", () => {
    for (const type of ["image/gif", "image/svg+xml", "application/pdf", ""]) {
      expect(validateAvatarFile({ type, size: 1000 })).toEqual({ ok: false, code: "profileIdentity.avatar.errorType" });
    }
  });

  it("never refuses the selected photo for its size, only an empty file", () => {
    expect(validateAvatarFile({ type: "image/jpeg", size: 80 * 1024 * 1024 })).toEqual({ ok: true });
    expect(validateAvatarFile({ type: "image/jpeg", size: 0 })).toEqual({
      ok: false,
      code: "profileIdentity.avatar.errorSize",
    });
  });
});
