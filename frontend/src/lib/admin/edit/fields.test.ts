import { describe, expect, it } from "vitest";
import { FORBIDDEN_EDIT_FIELDS, ORG_EDIT_FIELDS, USER_EDIT_FIELDS, isForbiddenField } from "./fields";

describe("the Option A allow-list", () => {
  it("contains no contact, legal, identity or verification field", () => {
    for (const f of [...USER_EDIT_FIELDS, ...ORG_EDIT_FIELDS]) expect(isForbiddenField(f.key), f.key).toBe(false);
    expect(new Set(FORBIDDEN_EDIT_FIELDS).size).toBe(FORBIDDEN_EDIT_FIELDS.length);
  });
  it("pins the exact editable surface so adding a field is a deliberate, reviewed change", () => {
    expect(USER_EDIT_FIELDS.map((f) => f.key)).toEqual(["display_name", "display_name_ar", "display_name_en", "headline", "bio", "languages", "governorate_key", "city_key", "city_custom_name", "available_for_work"]);
    expect(ORG_EDIT_FIELDS.map((f) => f.key)).toEqual(["name", "name_ar", "name_en", "description", "facebook_url", "instagram_url", "tiktok_url", "website_url", "primary_locale", "timezone"]);
  });
  it("treats the f_ prefix and case as irrelevant to the deny list", () => {
    expect(isForbiddenField("f_Phone_E164")).toBe(true);
    expect(isForbiddenField("LEGAL_NAME")).toBe(true);
    expect(isForbiddenField("headline")).toBe(false);
  });
});
