import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Admin edit, Option A: the server action reduces a form to an ALLOW-LISTED patch, requires a reason, and forwards to ONE
 * self-guarding RPC with the caller's session. Contact and legal fields are refused by name BEFORE any database call.
 */
const rpc = vi.fn();
const from = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(async () => ({ rpc, from })) }));

const { editUserProfileAction, editOrganizationAction, mapEditError } = await import("./admin-edit");

const USER = "70000001-0000-4000-8000-000000000001";
const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const form = (v: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, val] of Object.entries(v)) fd.set(k, val);
  return fd;
};
const initial = { ok: false };
const NOT_EDITABLE = "admin.profileEdit.error.notEditable";

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  rpc.mockResolvedValue({ data: { changed: true }, error: null });
});

describe("editUserProfileAction", () => {
  it("sends only allow-listed fields, trimmed, with the reason, to the one user RPC", async () => {
    const res = await editUserProfileAction(initial, form({
      subjectId: USER, reason: "  Abusive text removed ", f_display_name: " Mona Adel ", f_headline: "", f_bio: "Tiles", f_languages: "ar, EN",
      f_available_for_work__present: "1", f_available_for_work: "on", remove_avatar_media_id: "on",
    }));
    expect(res).toEqual({ ok: true, code: "admin.profileEdit.done" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("admin_user_edit_profile", {
      p_user_id: USER,
      p_reason: "Abusive text removed",
      p_changes: { display_name: "Mona Adel", headline: null, bio: "Tiles", languages: ["ar", "en"], available_for_work: true, avatar_media_id: null },
    });
    expect(from).not.toHaveBeenCalled(); // no direct table write
  });

  it("requires a reason before calling the database", async () => {
    const res = await editUserProfileAction(initial, form({ subjectId: USER, reason: "  ", f_headline: "x" }));
    expect(res).toMatchObject({ ok: false, code: "admin.profileEdit.error.reasonRequired" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    "phone", "phone_e164", "phone_national", "phone_country_iso2", "email", "contact_email", "contact_phone", "legal_name", "national_id",
    "tax_id", "bank_account", "iban", "username", "birth_date", "password", "org_type", "primary_account_type", "role", "is_verified",
    "status", "slug", "id", "user_id", "points", "created_by", "business_verified_at", "display_name_confirmed_at",
  ])("refuses a forged %s entry (bare or f_-prefixed) without calling the database, even next to an allowed field", async (name) => {
    for (const key of [name, `f_${name}`]) {
      const res = await editUserProfileAction(initial, form({ subjectId: USER, reason: "x", f_headline: "fine", [key]: "+201000000000" }));
      expect(res, key).toEqual({ ok: false, code: NOT_EDITABLE });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an f_ field that is not on the allow-list and a remove_ flag that is not a removable media", async () => {
    expect((await editUserProfileAction(initial, form({ subjectId: USER, reason: "x", f_favourite_colour: "red" }))).code).toBe(NOT_EDITABLE);
    expect((await editUserProfileAction(initial, form({ subjectId: USER, reason: "x", remove_logo_media_id: "on" }))).code).toBe(NOT_EDITABLE);
    expect((await editUserProfileAction(initial, form({ subjectId: USER, reason: "x", remove_phone_e164: "on" }))).code).toBe(NOT_EDITABLE);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never lets media be replaced: only a remove flag exists", async () => {
    const res = await editUserProfileAction(initial, form({ subjectId: USER, reason: "x", f_avatar_media_id: "a1000000-0000-4000-8000-000000000001" }));
    expect(res.code).toBe(NOT_EDITABLE);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an empty submission, an over-long value, a blank required name and malformed ids without calling the database", async () => {
    expect((await editUserProfileAction(initial, form({ subjectId: USER, reason: "x" }))).ok).toBe(false);
    expect((await editUserProfileAction(initial, form({ subjectId: USER, reason: "x", f_bio: "b".repeat(1001) }))).ok).toBe(false);
    expect((await editUserProfileAction(initial, form({ subjectId: USER, reason: "x", f_display_name: "  " }))).ok).toBe(false);
    expect((await editUserProfileAction(initial, form({ subjectId: USER, reason: "x", f_languages: "arabic-egyptian" }))).ok).toBe(false);
    expect((await editUserProfileAction(initial, form({ subjectId: "not-a-uuid", reason: "x", f_headline: "x" }))).ok).toBe(false);
    expect((await editUserProfileAction(initial, form({ subjectId: USER, reason: "r".repeat(501), f_headline: "x" }))).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports a no-op honestly and maps a database refusal to a key, never raw text", async () => {
    rpc.mockResolvedValueOnce({ data: { changed: false }, error: null });
    expect(await editUserProfileAction(initial, form({ subjectId: USER, reason: "x", f_headline: "same" }))).toEqual({ ok: true, code: "admin.profileEdit.noChange" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "you cannot edit Admin Staff at or above your own rank" } });
    expect(await editUserProfileAction(initial, form({ subjectId: USER, reason: "x", f_headline: "y" }))).toEqual({ ok: false, code: "admin.profileEdit.error.rank" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "field not editable" } });
    expect((await editUserProfileAction(initial, form({ subjectId: USER, reason: "x", f_headline: "y" }))).code).toBe(NOT_EDITABLE);
  });
});

describe("editOrganizationAction", () => {
  it("sends only allow-listed presentation fields to the one organization RPC", async () => {
    const res = await editOrganizationAction(initial, form({
      subjectId: ORG, reason: "Cleaned page", f_name: " Nile Supplies ", f_description: "Tiles and marble", f_website_url: "https://nile.example", remove_logo_media_id: "on",
    }));
    expect(res.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("admin_organization_edit", {
      p_organization_id: ORG,
      p_reason: "Cleaned page",
      p_changes: { name: "Nile Supplies", description: "Tiles and marble", website_url: "https://nile.example", logo_media_id: null },
    });
  });

  it.each([
    "legal_name", "org_type", "contact_phone", "contact_email", "phone", "email", "is_verified", "business_verified_at",
    "business_verification_id", "status", "deleted_at", "slug", "created_by", "owner", "tax_id", "bank_account", "iban", "id",
  ])("refuses a forged %s entry (bare or f_-prefixed) without calling the database", async (name) => {
    for (const key of [name, `f_${name}`]) {
      const res = await editOrganizationAction(initial, form({ subjectId: ORG, reason: "x", f_description: "fine", [key]: "Evil Ltd" }));
      expect(res, key).toEqual({ ok: false, code: NOT_EDITABLE });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires a reason", async () => {
    expect((await editOrganizationAction(initial, form({ subjectId: ORG, reason: "", f_description: "x" }))).code).toBe("admin.profileEdit.error.reasonRequired");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("mapEditError", () => {
  it("maps stable fragments and codes to keys", () => {
    expect(mapEditError({ code: "22023", message: "a reason is required" })).toBe("admin.profileEdit.error.reasonRequired");
    expect(mapEditError({ code: "42501", message: "you cannot edit your own account here" })).toBe("admin.profileEdit.error.self");
    expect(mapEditError({ code: "P0002", message: "user not found" })).toBe("admin.profileEdit.error.notFound");
    expect(mapEditError({ code: "22023", message: "invalid value" })).toBe("admin.profileEdit.error.invalid");
    expect(mapEditError({ code: "42501", message: "permission denied" })).toBe("admin.profileEdit.error.denied");
    expect(mapEditError({ code: "XX000" })).toBe("states.genericRetry");
  });
});
