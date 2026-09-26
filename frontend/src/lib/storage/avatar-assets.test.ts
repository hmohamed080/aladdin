import { describe, expect, it } from "vitest";
import { AVATAR_SOURCE_MAX_BYTES, validateAvatarFile } from "./avatar-assets";

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

  it("enforces the source-size limit and refuses an empty file", () => {
    expect(validateAvatarFile({ type: "image/jpeg", size: AVATAR_SOURCE_MAX_BYTES })).toEqual({ ok: true });
    expect(validateAvatarFile({ type: "image/jpeg", size: AVATAR_SOURCE_MAX_BYTES + 1 })).toEqual({
      ok: false,
      code: "profileIdentity.avatar.errorSize",
    });
    expect(validateAvatarFile({ type: "image/jpeg", size: 0 })).toEqual({
      ok: false,
      code: "profileIdentity.avatar.errorSize",
    });
  });
});
