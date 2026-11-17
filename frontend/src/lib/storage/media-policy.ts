import type { MediaNamespace } from "./provider-types";
import { ASSET_POLICY } from "./professional-assets";
import { AVATAR_ALLOWED_TYPES, AVATAR_BUCKET, AVATAR_MAX_BYTES } from "./avatar-assets";
import { PRODUCT_IMAGE_ALLOWED_TYPES, PRODUCT_IMAGE_BUCKET, PRODUCT_IMAGE_MAX_BYTES } from "./product-images";
import { REQUEST_IMAGE_ALLOWED_TYPES, REQUEST_IMAGE_BUCKET, REQUEST_IMAGE_MAX_BYTES } from "./request-images";
import { BV_ALLOWED_TYPES, BV_BUCKET, BV_MAX_BYTES } from "@/lib/business-verification/contract";
import { ORGANIZATION_IMAGE_ALLOWED_TYPES, ORGANIZATION_IMAGE_BUCKET, ORGANIZATION_IMAGE_MAX_BYTES } from "./organization-image-assets";
import { MARKETPLACE_IMAGE_ALLOWED_TYPES, MARKETPLACE_IMAGE_BUCKET, MARKETPLACE_IMAGE_MAX_BYTES } from "./marketplace-images";

export function mediaPolicy(namespace: MediaNamespace) {
  if (namespace === "avatar") return { bucket: AVATAR_BUCKET, maxBytes: AVATAR_MAX_BYTES, types: AVATAR_ALLOWED_TYPES };
  if (namespace === "product") return { bucket: PRODUCT_IMAGE_BUCKET, maxBytes: PRODUCT_IMAGE_MAX_BYTES, types: PRODUCT_IMAGE_ALLOWED_TYPES };
  if (namespace === "organization") return { bucket: ORGANIZATION_IMAGE_BUCKET, maxBytes: ORGANIZATION_IMAGE_MAX_BYTES, types: ORGANIZATION_IMAGE_ALLOWED_TYPES };
  if (namespace === "request") return { bucket: REQUEST_IMAGE_BUCKET, maxBytes: REQUEST_IMAGE_MAX_BYTES, types: REQUEST_IMAGE_ALLOWED_TYPES };
  if (namespace === "verification") return { bucket: BV_BUCKET, maxBytes: BV_MAX_BYTES, types: BV_ALLOWED_TYPES };
  if (namespace === "marketplace") return { bucket: MARKETPLACE_IMAGE_BUCKET, maxBytes: MARKETPLACE_IMAGE_MAX_BYTES, types: MARKETPLACE_IMAGE_ALLOWED_TYPES };
  return ASSET_POLICY[namespace];
}

/** Workspace- or organization-scoped namespaces are authorized by `organization_media_resolve`. */
export function isOrganizationMedia(namespace: MediaNamespace) {
  return namespace === "product" || namespace === "organization" || namespace === "request" || namespace === "verification"
    || namespace === "marketplace";
}
