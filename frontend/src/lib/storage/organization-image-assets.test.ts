import { describe, expect, it } from "vitest";
import { validateOrganizationImageFile } from "./organization-image-assets";

describe("business profile image validation", () => {
  it("accepts JPEG, PNG and WebP", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) expect(validateOrganizationImageFile({ type, size: 1024 })).toEqual({ ok: true });
  });
  it("refuses other types and empty files, never a large source", () => {
    expect(validateOrganizationImageFile({ type: "image/gif", size: 10 })).toEqual({ ok: false, code: "showroomSettings.image.errorType" });
    expect(validateOrganizationImageFile({ type: "application/pdf", size: 10 })).toEqual({ ok: false, code: "showroomSettings.image.errorType" });
    expect(validateOrganizationImageFile({ type: "image/png", size: 0 })).toEqual({ ok: false, code: "showroomSettings.image.errorSize" });
    expect(validateOrganizationImageFile({ type: "image/png", size: 80 * 1024 * 1024 })).toEqual({ ok: true });
  });
});
