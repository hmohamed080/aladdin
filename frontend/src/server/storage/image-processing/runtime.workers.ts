import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createCloudflareImageProcessor, type ImagesBindingLike } from "./cloudflare-processor";
import type { ImageProcessor } from "./types";

let cached: { binding: ImagesBindingLike; processor: ImageProcessor } | undefined;

/**
 * Cloudflare Workers build only (replaces `runtime.ts`, see next.config.ts):
 * sharp cannot load in workerd, so images go through the `IMAGES` binding
 * declared in wrangler.jsonc. No binding means no verification: fail, never skip.
 */
export function runtimeImageProcessor(): ImageProcessor {
  const binding = (getCloudflareContext().env as { IMAGES?: ImagesBindingLike }).IMAGES;
  if (!binding) throw new Error("Cloudflare Images binding IMAGES is not configured");
  if (cached?.binding !== binding) cached = { binding, processor: createCloudflareImageProcessor(binding) };
  return cached.processor;
}
