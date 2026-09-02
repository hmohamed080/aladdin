/**
 * The professional-asset storage contract, as code both sides can hold.
 *
 * PURE ON PURPOSE — no `server-only`, no Supabase client, no `next/*`. Increment
 * 11's upload control is a client component: it has to tell someone their file
 * is 8 MB *before* a request goes anywhere, and it can only do that if the rules
 * are importable from the browser. `lib/nav` and `lib/work/assignment-state`
 * make the same split for the same reason.
 *
 * NOTHING HERE IS AUTHORITY. Every rule in this file is also enforced somewhere
 * a caller cannot skip:
 *
 *   * ownership and the key shape — `app.is_professional_asset_key`, in the
 *     `storage.objects` policies;
 *   * who may create at all — `app.can_create_professional_asset`, in the two
 *     INSERT policies;
 *   * content type and size — `allowed_mime_types` and `file_size_limit` on the
 *     bucket, enforced by the Storage service before Postgres is consulted.
 *
 * So this module exists to give a person a good answer quickly, not to decide
 * anything. A browser that skipped it entirely would be refused at the same three
 * places. See docs/database/professional-asset-storage.md.
 */

/**
 * The two namespaces. They are separate BUCKETS rather than folders because
 * Supabase enforces MIME and size per bucket, and the two need different values
 * — a rule that lived only in this file would be a rule a caller could skip.
 */
export const ASSET_NAMESPACES = ["portfolio", "certificate"] as const;
export type AssetNamespace = (typeof ASSET_NAMESPACES)[number];

/**
 * Extension per content type. The extension is DERIVED from the validated type,
 * never read off the uploaded filename — §4's rule that a display name is not
 * authority, applied at the one place a filename could otherwise leak into a key.
 */
const EXTENSION_BY_TYPE: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

type NamespacePolicy = {
  readonly bucket: string;
  readonly types: readonly string[];
  readonly maxBytes: number;
};

export const ASSET_POLICY: Readonly<Record<AssetNamespace, NamespacePolicy>> = {
  /**
   * Work samples. Images only: there is no video pipeline, no transcoding and no
   * player in this product, and adding the type here would be storing something
   * nothing can play. 5 MiB is one 12 MP phone photo with room to spare.
   */
  portfolio: {
    bucket: "professional-portfolio",
    types: ["image/jpeg", "image/png", "image/webp"],
    maxBytes: 5 * 1024 * 1024,
  },
  /**
   * Evidence. PDF is what a certificate actually arrives as, and 10 MiB covers a
   * scan of several pages. Images are kept because plenty of people photograph
   * the certificate rather than scan it.
   */
  certificate: {
    bucket: "professional-certificates",
    types: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
    maxBytes: 10 * 1024 * 1024,
  },
};

/**
 * Neither list contains `image/svg+xml`. An SVG reads as a picture to a person
 * and as a scriptable document to a browser, and nothing in this repository
 * sanitizes one — so it stays out until something does, rather than being
 * allowed on the grounds that the bucket is private.
 */

export type AssetErrorCode =
  | "assets.errors.unsupportedType"
  | "assets.errors.tooLarge"
  | "assets.errors.empty"
  | "assets.errors.contentMismatch"
  | "assets.errors.invalidPath"
  | "assets.errors.notAllowed"
  | "assets.errors.uploadFailed"
  | "assets.errors.gone";

const KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$/;

/**
 * The object key: `<owner-uuid>/<object-uuid>.<ext>` and nothing else.
 *
 * The person's chosen filename is deliberately absent. §4 sketches it as a final
 * segment; dropping it means the key contains no caller-controlled bytes at all,
 * so traversal, encoding tricks, length limits and case collisions stop being
 * things to defend against and become things that cannot be expressed. The
 * display name is Increment 11 metadata, where being wrong is cosmetic.
 *
 * Mirrors `app.is_professional_asset_key` exactly; 47_professional_asset_storage
 * asserts the SQL side against the same table of attacks this module's test uses.
 */
export function buildAssetKey(ownerId: string, objectId: string, contentType: string): string {
  const ext = EXTENSION_BY_TYPE[contentType];
  if (!ext) throw new Error(`No extension is defined for content type ${contentType}`);
  return `${ownerId}/${objectId}.${ext}`;
}

/** True when `key` is a well-formed key owned by `ownerId`. Shape AND value. */
export function isAssetKeyOwnedBy(key: string, ownerId: string): boolean {
  if (!key || !ownerId) return false;
  if (!KEY_PATTERN.test(key)) return false;
  return key.slice(0, key.indexOf("/")) === ownerId;
}

export type AssetValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: AssetErrorCode };

/**
 * The pre-flight a person actually benefits from: type and size, checked before
 * anything is uploaded. Same numbers the buckets carry, so a file that passes
 * here is not going to be refused for these reasons afterwards.
 */
export function validateAssetFile(
  namespace: AssetNamespace,
  file: { readonly type: string; readonly size: number },
): AssetValidation {
  const policy = ASSET_POLICY[namespace];
  if (!policy.types.includes(file.type)) return { ok: false, code: "assets.errors.unsupportedType" };
  if (file.size <= 0) return { ok: false, code: "assets.errors.empty" };
  if (file.size > policy.maxBytes) return { ok: false, code: "assets.errors.tooLarge" };
  return { ok: true };
}

/**
 * File signatures, checked against the DECLARED content type.
 *
 * WHAT THIS IS FOR, PRECISELY. The bucket's `allowed_mime_types` compares against
 * the type the CALLER declares, so a caller who declares `image/png` and sends a
 * script is storing a script named PNG. This closes that gap for every upload
 * that goes through the product, which is all of them.
 *
 * WHAT IT IS NOT. It runs in the caller's own process, so a determined caller
 * skips it. It is a correctness net for honest mistakes and a first line against
 * dishonest ones — not a security boundary, and it is not described as one
 * anywhere. The boundary is the private bucket plus a type list with no
 * script-bearing format in it. Byte-level inspection with real authority belongs
 * to the FastAPI service, which is where a scanner would live.
 */
const SIGNATURES: ReadonlyArray<{ type: string; bytes: readonly number[]; offset?: number }> = [
  { type: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { type: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  // WebP is a RIFF container: "RIFF" .... "WEBP".
  { type: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] },
  { type: "image/webp", bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
];

/** True when `head` (the first ~16 bytes) is consistent with `contentType`. */
export function bytesMatchType(head: Uint8Array, contentType: string): boolean {
  const required = SIGNATURES.filter((s) => s.type === contentType);
  if (required.length === 0) return false;
  return required.every(({ bytes, offset = 0 }) =>
    bytes.every((b, i) => head[offset + i] === b),
  );
}

/**
 * Type + size + first bytes, in one call, for a caller that already has the
 * head of the file. Kept separate from `validateAssetFile` because reading bytes
 * needs an await and the cheap checks should be able to fail without one.
 */
export function validateAssetContent(
  namespace: AssetNamespace,
  file: { readonly type: string; readonly size: number },
  head: Uint8Array,
): AssetValidation {
  const basic = validateAssetFile(namespace, file);
  if (!basic.ok) return basic;
  if (!bytesMatchType(head, file.type)) return { ok: false, code: "assets.errors.contentMismatch" };
  return { ok: true };
}

/** How long a read URL lives. Long enough to render a page, short enough that a
 * copied URL is not a lasting handout. Minted per render, never stored. */
export const ASSET_READ_URL_SECONDS = 300;
