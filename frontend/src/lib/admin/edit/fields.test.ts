import { describe, expect, it } from "vitest";
import { buildEditPatch, FORBIDDEN_EDIT_FIELDS, ORG_EDIT_FIELDS, USER_EDIT_FIELDS, isForbiddenField } from "./fields";

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

describe("allow-list bypass attempts (form level)", () => {
  const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
  const user = (o: Record<string, string>) => buildEditPatch(fd(o), USER_EDIT_FIELDS, ["avatar_media_id", "cover_media_id"]);
  it("matches the database limit for the bio (250), so no value passes the form and then fails the trigger", () => {
    expect(user({ f_bio: "b".repeat(250) }).ok).toBe(true);
    expect(user({ f_bio: "b".repeat(251) }).ok).toBe(false);
  });
  it("refuses a forbidden key in any case, prefixed or not, next to an allowed one", () => {
    for (const k of ["PHONE", "f_Email", "remove_phone", "F_LEGAL_NAME", "f_f_phone", "f_phone_e164__present"]) {
      expect(user({ f_headline: "ok", [k]: "x" }).ok, k).toBe(false);
    }
  });
  it("never reads look-alike or aliased keys as an allowed field", () => {
    const r = user({ f_headline: "ok", "f_head​line": "evil", f_Bio: "evil", "f_bio ": "evil", "f_headline[]": "evil" });
    expect(r.ok).toBe(false);
  });
  it("only ever emits keys from the allow-list (mass assignment)", () => {
    const r = user({ f_headline: "ok", subjectId: "x", reason: "y", $ACTION_ID_abc: "", remove_avatar_media_id: "on" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.changes).sort()).toEqual(["avatar_media_id", "headline"]);
  });
});
