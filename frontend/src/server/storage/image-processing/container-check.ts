/**
 * Structural completeness of a JPEG, PNG or WebP file in plain JS: the right
 * signature for the declared type, every segment/chunk inside the file, PNG CRCs,
 * an end marker after the image data, and no animation. Cheap (no pixels).
 *
 * Why it exists: on Workers the pixel decode happens in Cloudflare Images, which
 * is built to render what it can of a damaged file. sharp's `failOn: "warning"`
 * refuses a truncated file on Node; this keeps that refusal on Workers.
 */
export function checkImageContainer(bytes: Uint8Array, contentType: string): void {
  const ok = contentType === "image/jpeg" ? jpegComplete(bytes)
    : contentType === "image/png" ? pngComplete(bytes)
    : contentType === "image/webp" ? webpComplete(bytes)
    : false;
  if (!ok) throw new Error("unsupported image");
}

function jpegComplete(b: Uint8Array): boolean {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return false;
  let at = 2;
  let frame = false;
  while (at + 1 < b.length) {
    if (b[at] !== 0xff) return false;
    while (b[at] === 0xff && at < b.length) at++; // fill bytes
    const marker = b[at++];
    if (marker === undefined || marker === 0xd9) return false; // ended before any scan
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue; // no length
    if (at + 2 > b.length) return false;
    const end = at + ((b[at]! << 8) | b[at + 1]!);
    if (end > b.length || end < at + 2) return false;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) frame = true;
    if (marker === 0xda) {
      // Entropy-coded data byte-stuffs 0xFF, so FF D9 after the first scan is the
      // end of image (multi-picture files may carry more after it).
      for (let i = end; i + 1 < b.length; i++) if (b[i] === 0xff && b[i + 1] === 0xd9) return frame;
      return false;
    }
    at = end;
  }
  return false;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(b: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngComplete(b: Uint8Array): boolean {
  if (b.length < 8 || PNG_SIGNATURE.some((v, i) => b[i] !== v)) return false;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let at = 8;
  let first = true;
  let data = false;
  while (at + 12 <= b.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(b[at + 4]!, b[at + 5]!, b[at + 6]!, b[at + 7]!);
    const end = at + 12 + length;
    if (end > b.length || crc32(b, at + 4, at + 8 + length) !== view.getUint32(at + 8 + length)) return false;
    if (first && type !== "IHDR") return false;
    if (type === "acTL") return false; // animated PNG
    if (type === "IDAT") data = true;
    if (type === "IEND") return data;
    first = false;
    at = end;
  }
  return false;
}

function webpComplete(b: Uint8Array): boolean {
  const tag = (at: number) => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
  if (b.length < 20 || tag(0) !== "RIFF" || tag(8) !== "WEBP") return false;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const riffEnd = 8 + view.getUint32(4, true);
  if (riffEnd > b.length) return false;
  let at = 12;
  let image = false;
  while (at + 8 <= riffEnd) {
    const type = tag(at);
    const size = view.getUint32(at + 4, true);
    const end = at + 8 + size;
    if (end > riffEnd) return false;
    if (type === "VP8X" && size >= 1 && (b[at + 8]! & 0x02) !== 0) return false; // animation flag
    if (type === "ANIM" || type === "ANMF") return false;
    if (type === "VP8 " || type === "VP8L") image = true;
    at = end + (size & 1);
  }
  return image && at >= riffEnd;
}
