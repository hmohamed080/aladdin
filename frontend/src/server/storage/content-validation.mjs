import { createHash } from "node:crypto";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";

let activeDecoders = 0;
/** Per-instance backpressure; holds no user/session data and bounds native decode memory. */
export async function withMediaProcessingSlot(work) {
  if (activeDecoders >= 2) throw new Error("media verification busy; retry");
  activeDecoders++;
  try { return await work(); } finally { activeDecoders--; }
}

export async function verifyMediaBytes(bytes, contentType, maxBytes) {
  return withMediaProcessingSlot(async () => {
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) throw new Error("invalid stored size");
  if (contentType === "application/pdf") {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, throwOnInvalidObject: true });
    if (pdf.getPageCount() === 0) throw new Error("empty PDF");
  } else {
    const image = sharp(bytes, { limitInputPixels: 25_000_000, failOn: "warning" });
    const metadata = await image.metadata();
    const types = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
    if (!metadata.format || types[metadata.format] !== contentType || (metadata.pages ?? 1) !== 1) {
      throw new Error("unsupported image");
    }
    // metadata() alone accepts truncated images; force a full bounded decode.
    await image.raw().toBuffer();
  }
  return { size: bytes.byteLength, contentType, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
}

export async function readBoundedBody(response, maxBytes) {
  if (!response.ok || !response.body) throw new Error("object unavailable");
  const length = Number(response.headers.get("content-length"));
  if (length > maxBytes) { await response.body.cancel(); throw new Error("object too large"); }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("object too large");
      chunks.push(value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  finally { reader.releaseLock(); }
  return new Uint8Array(Buffer.concat(chunks, size));
}
