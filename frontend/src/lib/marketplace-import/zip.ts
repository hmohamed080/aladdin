/**
 * A minimal, dependency-free ZIP reader for the Marketplace bulk import.
 *
 * An .xlsx workbook IS a zip of XML parts, and sellers send product photos as a
 * zip, so the import needs exactly one capability: list the entries of a zip and
 * inflate the ones it asks for. Both the browser and Node (18+) ship
 * `DecompressionStream("deflate-raw")`, so this runs on either side with no
 * library. Only the two methods real tools write are supported — stored (0) and
 * deflate (8); anything else (encryption, zip64 beyond 4 GB) is refused
 * explicitly rather than read wrongly.
 */

export type ZipEntry = {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
  /** Offset of the LOCAL file header. */
  offset: number;
  encrypted: boolean;
};

export class ZipError extends Error {}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function u16(v: DataView, o: number) {
  return v.getUint16(o, true);
}
function u32(v: DataView, o: number) {
  return v.getUint32(o, true);
}

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder("utf-8").decode(bytes);
  // Legacy CP437 names: ASCII is identical; anything else is kept as UTF-8 best effort.
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/** Lists the entries of a zip archive from its central directory. */
export function listZipEntries(data: Uint8Array): ZipEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // The end-of-central-directory record sits in the last 22 + up to 65535 bytes.
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65535); i -= 1) {
    if (u32(view, i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("not_a_zip");
  const count = u16(view, eocd + 10);
  const cenOffset = u32(view, eocd + 16);
  if (cenOffset === 0xffffffff || count === 0xffff) throw new ZipError("zip64_unsupported");

  const entries: ZipEntry[] = [];
  let p = cenOffset;
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > data.length || u32(view, p) !== CEN_SIG) throw new ZipError("corrupt_central_directory");
    const flags = u16(view, p + 8);
    const method = u16(view, p + 10);
    const compressedSize = u32(view, p + 20);
    const uncompressedSize = u32(view, p + 24);
    const nameLen = u16(view, p + 28);
    const extraLen = u16(view, p + 30);
    const commentLen = u16(view, p + 32);
    const offset = u32(view, p + 42);
    const name = decodeName(data.subarray(p + 46, p + 46 + nameLen), (flags & 0x0800) !== 0);
    entries.push({ name, compressedSize, uncompressedSize, method, offset, encrypted: (flags & 0x0001) !== 0 });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads (and inflates) one entry. */
export async function readZipEntry(data: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  if (entry.encrypted) throw new ZipError("encrypted_entry");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (u32(view, entry.offset) !== LOC_SIG) throw new ZipError("corrupt_local_header");
  const nameLen = u16(view, entry.offset + 26);
  const extraLen = u16(view, entry.offset + 28);
  const start = entry.offset + 30 + nameLen + extraLen;
  const raw = data.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw.slice();
  if (entry.method === 8) return inflateRaw(raw);
  throw new ZipError("unsupported_compression");
}
