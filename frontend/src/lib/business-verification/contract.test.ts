import { describe, expect, it } from "vitest";
import { BV_MAX_BYTES, isBvKey, isBvStatus, mapBvError, validateBvFile } from "./contract";
import { en } from "@/lib/i18n/messages/en";
import { ar } from "@/lib/i18n/messages/ar";
import { createTranslator } from "@/lib/i18n/translate";

const ORG = "11111111-1111-4111-8111-111111111111";
const OBJ = "22222222-2222-4222-8222-222222222222";

describe("business verification contract", () => {
  it("accepts only server-minted keys", () => {
    expect(isBvKey(`${ORG}/${OBJ}.pdf`)).toBe(true);
    expect(isBvKey(`${ORG}/${OBJ}.webp`)).toBe(true);
    expect(isBvKey(`${ORG}/${OBJ}.svg`)).toBe(false);
    expect(isBvKey(`${ORG}/../${OBJ}.pdf`)).toBe(false);
    expect(isBvKey(`${OBJ}.pdf`)).toBe(false);
  });

  it("checks type and size before anything uploads", () => {
    expect(validateBvFile({ type: "application/pdf", size: 1000 })).toEqual({ ok: true });
    expect(validateBvFile({ type: "image/svg+xml", size: 1000 })).toEqual({ ok: false, code: "businessVerification.errors.fileType" });
    expect(validateBvFile({ type: "image/png", size: BV_MAX_BYTES + 1 })).toEqual({ ok: false, code: "businessVerification.errors.fileSize" });
    expect(validateBvFile({ type: "image/png", size: 0 })).toEqual({ ok: false, code: "businessVerification.errors.fileSize" });
  });

  it("knows only the six statuses", () => {
    expect(isBvStatus("needs_info")).toBe(true);
    expect(isBvStatus("approved")).toBe(false);
  });

  it("maps database refusals to copy and never leaks raw text", () => {
    expect(mapBvError("a reviewer may not review their own organization")).toBe("businessVerification.errors.ownOrganization");
    expect(mapBvError("admin permission verification.approve required")).toBe("businessVerification.errors.noApproveAuthority");
    expect(mapBvError("a first request needs at least one document")).toBe("businessVerification.errors.documentRequired");
    expect(mapBvError("a reason of 1 to 2000 characters is required when rejecting")).toBe("businessVerification.errors.reasonRequired");
    expect(mapBvError("something unexpected")).toBe("states.genericRetry");
  });

  it("has English and Arabic copy for every error key it can return", () => {
    const keys = Object.keys(en.businessVerification.errors);
    expect(Object.keys(ar.businessVerification.errors).sort()).toEqual([...keys].sort());
    for (const locale of ["en", "ar"] as const) {
      const t = createTranslator(locale);
      for (const k of keys) expect(t(`businessVerification.errors.${k}`)).not.toContain("businessVerification.");
    }
  });
});
