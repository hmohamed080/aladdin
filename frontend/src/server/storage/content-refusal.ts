/**
 * ADR-0032: which verification failures mean "this file will never be accepted", so its reservation is released at once.
 * Everything else (storage unreachable, busy decoder, image quota, a generic processor failure) may succeed on a retry; the
 * reservation then stays and expires by itself after an hour.
 */
const REFUSALS = new Set([
  "invalid stored size",
  "object too large",
  "empty PDF",
  "unsupported image",
  "image does not fit the size limit once re-encoded",
]);

const RETRYABLE = new Set([
  "media verification busy; retry",
  "no image verifier",
  "image processing quota exceeded",
  "image could not be processed",
  "Cloudflare Images binding IMAGES is not configured",
]);

/** Reading or re-encoding: only the named refusals are final (a network error must not discard the upload). */
export function isFinalRefusal(error: unknown): boolean {
  return error instanceof Error && (REFUSALS.has(error.message) || error.name === "MetadataStripError");
}

/** Decoding the bytes already read: any decoder complaint is about the file, except the known retryable ones. */
export function isDecodeRefusal(error: unknown): boolean {
  return error instanceof Error && !RETRYABLE.has(error.message);
}
