import "server-only";
import { sharpImageProcessor } from "./sharp-processor";
import type { ImageProcessor } from "./types";

/**
 * Node (local development and tests). The Workers build swaps this module for `runtime.workers.ts`
 * (next.config.ts, ALADDIN_BUILD_TARGET=workers), which is how sharp stays out
 * of the Worker bundle entirely.
 */
export function runtimeImageProcessor(): ImageProcessor {
  return sharpImageProcessor;
}
