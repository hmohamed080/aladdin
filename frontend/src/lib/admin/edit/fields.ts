/**
 * Admin edit, Option A (docs/admin/ADMIN_EDIT_DECISION_BRIEF.md): the ONE allow-list of fields an admin may change.
 *
 * Moderation / presentation fields only. Contact and legal data (phone, email, legal name, national id, bank details,
 * organization type, verification state, slug, ownership, status, ids, points, credentials) are NOT here and are refused
 * by name in `server/actions/admin-edit.ts` before any database call; the RPCs (`admin_user_edit_profile`,
 * `admin_organization_edit`, 20261114090005) refuse them again. Media is remove-only.
 */

export type EditKind = "text" | "textarea" | "boolean" | "languages";
export type EditField = { key: string; kind: EditKind; max: number; required?: boolean };

export const USER_EDIT_FIELDS: readonly EditField[] = [
  { key: "display_name", kind: "text", max: 80, required: true },
  { key: "display_name_ar", kind: "text", max: 80 },
  { key: "display_name_en", kind: "text", max: 80 },
  { key: "headline", kind: "text", max: 120 },
  { key: "bio", kind: "textarea", max: 1000 },
  { key: "languages", kind: "languages", max: 40 },
  { key: "governorate_key", kind: "text", max: 40 },
  { key: "city_key", kind: "text", max: 40 },
  { key: "city_custom_name", kind: "text", max: 80 },
  { key: "available_for_work", kind: "boolean", max: 0 },
];
/** Remove-only media: the form can only send "remove", never a replacement. */
export const USER_REMOVABLE_MEDIA = ["avatar_media_id", "cover_media_id"] as const;

export const ORG_EDIT_FIELDS: readonly EditField[] = [
  { key: "name", kind: "text", max: 120, required: true },
  { key: "name_ar", kind: "text", max: 120 },
  { key: "name_en", kind: "text", max: 120 },
  { key: "description", kind: "textarea", max: 250 },
  { key: "facebook_url", kind: "text", max: 300 },
  { key: "instagram_url", kind: "text", max: 300 },
  { key: "tiktok_url", kind: "text", max: 300 },
  { key: "website_url", kind: "text", max: 300 },
  { key: "primary_locale", kind: "text", max: 2, required: true },
  { key: "timezone", kind: "text", max: 64 },
];
export const ORG_REMOVABLE_MEDIA = ["logo_media_id"] as const;

/**
 * Names that must NEVER reach an edit RPC, whatever the value. Checked against every submitted form key (with or without the
 * `f_` prefix) so that a forged form cannot smuggle a contact or legal field in next to an allowed one.
 */
export const FORBIDDEN_EDIT_FIELDS: readonly string[] = [
  "phone", "phone_e164", "phone_national", "phone_country_iso2", "phone_verified_at", "secondary_phone", "mobile", "whatsapp",
  "email", "contact_email", "contact_phone", "login_email",
  "legal_name", "national_id", "nationalid", "tax_id", "tax_number", "commercial_register", "bank", "bank_account", "iban", "swift",
  "username", "birth_date", "birthday", "password",
  "org_type", "primary_account_type", "account_type", "role", "roles", "permissions",
  "is_verified", "business_verified_at", "business_verification_id", "verification_status", "status", "deleted_at",
  "slug", "owner", "owner_id", "created_by", "id", "user_id", "organization_id", "points", "balance",
  "display_name_confirmed_at", "public_profile_status",
];

const norm = (k: string) => k.toLowerCase().replace(/^f_/, "");
export function isForbiddenField(key: string): boolean {
  const k = norm(key);
  return FORBIDDEN_EDIT_FIELDS.includes(k);
}

export type PatchResult =
  | { ok: true; changes: Record<string, string | boolean | string[] | null> }
  | { ok: false; code: "notEditable" | "invalid" | "reasonRequired"; field?: string };

/**
 * Builds the RPC patch from a submitted form. Only `f_<allowed key>` entries and `remove_<allowed media>` flags are read.
 * Anything else in the form that is a forbidden name, or an `f_` entry that is not allowed, rejects the WHOLE submission.
 */
export function buildEditPatch(fd: FormData, fields: readonly EditField[], media: readonly string[]): PatchResult {
  const allowed = new Map(fields.map((f) => [f.key, f]));
  for (const key of new Set([...fd.keys()])) {
    if (isForbiddenField(key) || isForbiddenField(key.replace(/^remove_/, ""))) return { ok: false, code: "notEditable", field: key };
    if (key.startsWith("f_") && !allowed.has(key.slice(2).replace(/__present$/, ""))) return { ok: false, code: "notEditable", field: key };
    if (key.startsWith("remove_") && !media.includes(key.slice(7))) return { ok: false, code: "notEditable", field: key };
  }
  const changes: Record<string, string | boolean | string[] | null> = {};
  for (const f of fields) {
    const entry = fd.get(`f_${f.key}`);
    if (f.kind === "boolean") {
      if (fd.has(`f_${f.key}__present`)) changes[f.key] = entry === "on" || entry === "true";
      continue;
    }
    if (typeof entry !== "string") continue;
    const v = entry.trim();
    if (v.length > f.max) return { ok: false, code: "invalid", field: f.key };
    if (f.required && !v) return { ok: false, code: "invalid", field: f.key };
    if (f.kind === "languages") {
      const parts = v ? v.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) : [];
      if (parts.length > 8 || parts.some((p) => !/^[a-z]{2,3}$/.test(p))) return { ok: false, code: "invalid", field: f.key };
      changes[f.key] = parts;
    } else {
      changes[f.key] = v === "" ? null : v;
    }
  }
  for (const m of media) if (fd.get(`remove_${m}`) === "on") changes[m] = null;
  if (Object.keys(changes).length === 0) return { ok: false, code: "invalid" };
  return { ok: true, changes };
}
