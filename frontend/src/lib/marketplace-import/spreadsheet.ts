import { listZipEntries, readZipEntry, ZipError } from "./zip";

/**
 * Reads the FIRST worksheet of an .xlsx workbook, or a CSV file, into a grid of
 * strings. Dependency-free: an .xlsx is a zip of XML parts (see `zip.ts`); only
 * the parts needed for cell VALUES are read — shared strings, the workbook's
 * sheet order, and the first sheet. Formulas yield their cached value, dates
 * stay as the stored serial number (the import has no date columns), and styling
 * is ignored.
 */

export type SheetGrid = string[][];

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e.startsWith("#x")) return String.fromCodePoint(Number.parseInt(e.slice(2), 16));
    if (e.startsWith("#")) return String.fromCodePoint(Number.parseInt(e.slice(1), 10));
    return XML_ENTITIES[e] ?? "";
  });
}

/** Text of every <t> inside a string item (handles rich-text runs). */
function textOf(fragment: string): string {
  let out = "";
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment))) out += m[1] ?? "";
  return unescapeXml(out);
}

/** "AB12" -> zero-based column index 27. */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const decoder = new TextDecoder("utf-8");

export async function readXlsx(data: Uint8Array): Promise<SheetGrid> {
  const entries = listZipEntries(data);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const read = async (name: string) => {
    const e = byName.get(name);
    return e ? decoder.decode(await readZipEntry(data, e)) : null;
  };

  // The first sheet in WORKBOOK order (not file order), through its relationship id.
  const workbook = await read("xl/workbook.xml");
  const rels = await read("xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new ZipError("not_an_xlsx");
  const firstSheetRid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1];
  const target = firstSheetRid
    ? new RegExp(`<Relationship\\b[^>]*\\bId="${firstSheetRid}"[^>]*\\bTarget="([^"]+)"`).exec(rels)?.[1] ??
      new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${firstSheetRid}"`).exec(rels)?.[1]
    : undefined;
  const sheetPath = target ? (target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`) : "xl/worksheets/sheet1.xml";
  const sheet = await read(sheetPath);
  if (!sheet) throw new ZipError("sheet_not_found");

  const sharedXml = (await read("xl/sharedStrings.xml")) ?? "";
  const shared: string[] = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let sm: RegExpExecArray | null;
  while ((sm = siRe.exec(sharedXml))) shared.push(textOf(sm[1] ?? ""));

  const grid: SheetGrid = [];
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(sheet))) {
    const rowNumber = Number.parseInt(/\br="(\d+)"/.exec(rm[1] ?? "")?.[1] ?? String(grid.length + 1), 10);
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    let position = 0;
    while ((cm = cellRe.exec(rm[2] ?? ""))) {
      const attrs = cm[1] ?? "";
      const body = cm[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const col = ref ? columnIndex(ref) : position;
      position = col + 1;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      let value = "";
      if (type === "s") value = shared[Number.parseInt(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "-1", 10)] ?? "";
      else if (type === "inlineStr") value = textOf(body);
      else value = unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
      cells[col] = value;
    }
    grid[rowNumber - 1] = Array.from(cells, (c) => c ?? "");
  }
  return Array.from(grid, (r) => r ?? []);
}

/** RFC 4180 CSV (quotes, escaped quotes, CRLF/LF), with a UTF-8 BOM stripped. */
export function readCsv(text: string): SheetGrid {
  const s = text.replace(/^﻿/, "");
  const rows: SheetGrid = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export async function readSpreadsheet(fileName: string, data: Uint8Array): Promise<SheetGrid> {
  if (/\.xlsx$/i.test(fileName)) return readXlsx(data);
  if (/\.csv$/i.test(fileName)) return readCsv(decoder.decode(data));
  throw new ZipError("unsupported_file_type");
}
