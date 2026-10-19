import type { MediaNamespace } from "./provider-types";
import { ASSET_POLICY } from "./professional-assets";
import { AVATAR_ALLOWED_TYPES, AVATAR_BUCKET, AVATAR_MAX_BYTES } from "./avatar-assets";
import { PRODUCT_IMAGE_ALLOWED_TYPES, PRODUCT_IMAGE_BUCKET, PRODUCT_IMAGE_MAX_BYTES } from "./product-images";
import { ORGANIZATION_IMAGE_ALLOWED_TYPES, ORGANIZATION_IMAGE_BUCKET, ORGANIZATION_IMAGE_MAX_BYTES } from "./organization-image-assets";

export function mediaPolicy(namespace: MediaNamespace) {
  if (namespace === "avatar") return { bucket: AVATAR_BUCKET, maxBytes: AVATAR_MAX_BYTES, types: AVATAR_ALLOWED_TYPES };
  if (namespace === "product") return { bucket: PRODUCT_IMAGE_BUCKET, maxBytes: PRODUCT_IMAGE_MAX_BYTES, types: PRODUCT_IMAGE_ALLOWED_TYPES };
  if (namespace === "organization") return { bucket: ORGANIZATION_IMAGE_BUCKET, maxBytes: ORGANIZATION_IMAGE_MAX_BYTES, types: ORGANIZATION_IMAGE_ALLOWED_TYPES };
  return ASSET_POLICY[namespace];
}

export function isOrganizationMedia(namespace: MediaNamespace) { return namespace === "product" || namespace === "organization"; }
