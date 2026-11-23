/**
 * Removes personal metadata from JPEG, PNG and WebP bytes WITHOUT touching the pixels or the
 * colour profile. PURE (no node APIs, no sharp, no Workers binding) so the Node and the Workers
 * image engines run the identical last pass, and a test can prove it on hand-built files.
 *
 * Dropped: EXIF (camera, device, GPS, timestamps), XMP, IPTC / Photoshop resources, comments and
 * every text / time chunk. Kept: everything that decides how the pixels look — the ICC profile,
 * the sRGB / gamma / chromaticity tags, the JFIF and Adobe (colour transform) markers, the alpha
 * and palette data. The image engines bake the EXIF orientation into the pixels before this runs,
 * so dropping the EXIF block never turns a picture sideways.
 *
 * It is the second guard behind the engines' own metadata-free output: an engine option that
 * silently changes between versions cannot leak a GPS position.
 */
export class MetadataStripError extends Error {
  constructor() { super("image container is malformed"); this.name = "MetadataStripError"; }
}

const ICC_SIGNATURE = [0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00]; // "ICC_PROFILE\0"

function startsWith(bytes: Uint8Array, offset: number, signature: readonly number[]): boolean {
  return signature.every((value, i) => bytes[offset + i] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i] ?? 0);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.byteLength; }
  return out;
}

/** JPEG: APP0 (JFIF), APP2 (ICC only) and APP14 (Adobe) stay; every other APPn and COM goes. */
function stripJpeg(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new MetadataStripError();
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i < bytes.byteLength) {
    if (bytes[i] !== 0xff) throw new MetadataStripError();
    let marker = bytes[i + 1];
    let markerAt = i;
    while (marker === 0xff) { markerAt++; marker = bytes[markerAt + 1]; } // fill bytes
    if (marker === undefined) throw new MetadataStripError();
    // Start of scan or end of image: what follows is entropy-coded data, copied untouched.
    if (marker === 0xda || marker === 0xd9) { parts.push(bytes.subarray(markerAt)); return concat(parts); }
    // Markers that carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { parts.push(bytes.subarray(markerAt, markerAt + 2)); i = markerAt + 2; continue; }
    if (markerAt + 4 > bytes.byteLength) throw new MetadataStripError();
    const length = (bytes[markerAt + 2]! << 8) | bytes[markerAt + 3]!;
    const end = markerAt + 2 + length;
    if (length < 2 || end > bytes.byteLength) throw new MetadataStripError();
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const keep = !isApp && marker !== 0xfe
      || marker === 0xe0
      || marker === 0xee
      || (marker === 0xe2 && startsWith(bytes, markerAt + 4, ICC_SIGNATURE));
    if (keep) parts.push(bytes.subarray(markerAt, end));
    i = end;
  }
  throw new MetadataStripError(); // never reached a scan: not a complete JPEG
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Chunks that decide pixels and colour. Anything else (eXIf, tEXt, zTXt, iTXt, tIME, ...) goes. */
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "iCCP", "sRGB", "gAMA", "cHRM", "cICP", "mDCV", "cLLI", "sBIT", "bKGD", "pHYs"]);

function stripPng(bytes: Uint8Array): Uint8Array {
  if (!startsWith(bytes, 0, PNG_SIGNATURE)) throw new MetadataStripError();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let i = 8;
  let sawEnd = false;
  while (i < bytes.byteLength) {
    if (i + 12 > bytes.byteLength) throw new MetadataStripError();
    const length = view.getUint32(i);
    const end = i + 12 + length;
    if (end > bytes.byteLength) throw new MetadataStripError();
    const type = ascii(bytes, i + 4, 4);
    if (PNG_KEEP.has(type)) parts.push(bytes.subarray(i, end));
    i = end;
    if (type === "IEND") { sawEnd = true; break; } // bytes after IEND are dropped
  }
  if (!sawEnd) throw new MetadataStripError();
  return concat(parts);
}

/** WebP: EXIF and XMP chunks go, and their two flag bits in VP8X are cleared. The RIFF size is rewritten. */
function stripWebp(bytes: Uint8Array): Uint8Array {
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP" || bytes.byteLength < 12) throw new MetadataStripError();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffEnd = Math.min(bytes.byteLength, 8 + view.getUint32(4, true));
  const parts: Uint8Array[] = [];
  let i = 12;
  while (i < riffEnd) {
    if (i + 8 > riffEnd) throw new MetadataStripError();
    const fourcc = ascii(bytes, i, 4);
    const size = view.getUint32(i + 4, true);
    const padded = size + (size & 1);
    const end = i + 8 + padded;
    if (end > riffEnd) throw new MetadataStripError();
    if (fourcc !== "EXIF" && fourcc !== "XMP ") {
      const chunk = bytes.slice(i, end);
      if (fourcc === "VP8X" && size >= 10) chunk[8] = chunk[8]! & ~0x0c;
      parts.push(chunk);
    }
    i = end;
  }
  const body = concat(parts);
  const out = new Uint8Array(12 + body.byteLength);
  out.set(bytes.subarray(0, 12));
  new DataView(out.buffer).setUint32(4, 4 + body.byteLength, true);
  out.set(body, 12);
  return out;
}

export function stripPersonalMetadata(bytes: Uint8Array, contentType: string): Uint8Array {
  if (contentType === "image/jpeg") return stripJpeg(bytes);
  if (contentType === "image/png") return stripPng(bytes);
  if (contentType === "image/webp") return stripWebp(bytes);
  throw new MetadataStripError();
}

/**
 * True when the bytes still carry a block that can hold personal data. Used by tests and by the
 * verifier's own self-check after a strip; it reads the same container structure.
 */
export function hasPersonalMetadata(bytes: Uint8Array, contentType: string): boolean {
  const stripped = stripPersonalMetadata(bytes, contentType);
  return stripped.byteLength !== bytes.byteLength;
}
