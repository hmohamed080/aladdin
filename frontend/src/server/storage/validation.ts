import "server-only";
import { verifyMediaBytes as verifyWith } from "./content-validation.mjs";
import { runtimeImageProcessor } from "./image-processing/runtime";

export { readBoundedBody, withMediaProcessingSlot } from "./content-validation.mjs";

/** Verifies with this runtime's image engine (sharp on Node, Cloudflare Images on Workers). */
export function verifyMediaBytes(bytes: Uint8Array, contentType: string, maxBytes: number) {
  return verifyWith(bytes, contentType, maxBytes, (image, type) => runtimeImageProcessor().verify(image, type));
}
