/**
 * Turns a seller's spreadsheet into the rows the import RPCs stage — pure, so the
 * normalisation, grouping and image matching rules are testable and identical in
 * the preview and the real run.
 *
 * The DATABASE stays the authority: every staged row is validated again server
 * side (`app.marketplace_import_row_findings`). This module only maps columns,
 * normalises what a real Egyptian catalogue export looks like (Arabic-Indic
 * digits, `٬` thousands separators, codes with `:` or spaces), and predicts the
 * most common refusals so the seller sees them before uploading anything.
 */

export type SheetGrid = string[][];

/** Where one target field takes its value from. */
export type FieldSource =
  | { kind: "column"; column: number }
  | { kind: "constant"; value: string }
  /** `{3}` is replaced by column 3's value (0-based), e.g. `ورق حائط {2} {0}`. */
  | { kind: "template"; template: string }
  | { kind: "none" };

export const TARGET_FIELDS = [
  "code",
  "product_type",
  "name_ar",
  "name_en",
  "description_ar",
  "description_en",
  "brand",
  "selling_unit",
  "price",
  "quantity",
] as const;
export type TargetField = (typeof TARGET_FIELDS)[number];

export type ImportConfig = {
  /** 0-based index of the header row (rows above it are ignored). */
  headerRow: number;
  fields: Record<TargetField, FieldSource>;
  /** Group codes that differ only by a trailing `-N` into one product with several variants. */
  groupBySuffix: boolean;
  /**
   * Attribute values applied to EVERY row, one `key=value` per line (e.g.
   * `material_wallpaper=non_woven`). A column headed `attr:<key>` sets that
   * attribute per row and wins over a fixed value.
   */
  fixedAttributes?: string;
};

export type AttributeValue = string | boolean | string[];

export type PlannedRow = {
  row_number: number;
  source_code: string;
  external_ref: string;
  sku: string;
  product_type: string;
  name_ar: string;
  name_en: string;
  description_ar?: string;
  description_en?: string;
  brand?: string;
  selling_unit: string;
  price: string;
  quantity?: string;
  attributes: Record<string, AttributeValue>;
};

export type LocalIssue = { row_number: number; code: string; field: TargetField | "sku"; detail?: string };

export type ImportPlan = {
  rows: PlannedRow[];
  /** Rows refused before upload (never staged). */
  rejected: LocalIssue[];
  /** Staged, but the server is expected to flag them (shown as a prediction). */
  warnings: LocalIssue[];
  products: number;
  variantRows: number;
  singleVariantProducts: number;
};

const ARABIC_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

/** Arabic-Indic / Persian digits to ASCII; `٬` and `,` thousands separators removed; `٫` becomes `.`. */
export function normalizeNumber(raw: string): string {
  let s = (raw ?? "").trim().replace(/[٠-٩۰-۹]/g, (d) => ARABIC_DIGITS[d] ?? d);
  s = s.replace(/[٬,\s]/g, "").replace(/٫/g, ".");
  // "1250.0" from a spreadsheet number cell is still 1250
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, "");
  return s;
}

/**
 * A seller code to a SKU the catalogue accepts (`^[A-Za-z0-9][A-Za-z0-9._/-]*$`,
 * max 64): every other character becomes `-`, runs collapse, ends are trimmed.
 * `106:Jaguar:161-003` → `106-Jaguar-161-003`. Codes with no Latin letter or
 * digit at all normalise to "" and are refused (never invented).
 */
export function normalizeSku(code: string): string {
  return (code ?? "")
    .trim()
    .replace(/[٠-٩۰-۹]/g, (d) => ARABIC_DIGITS[d] ?? d)
    .replace(/[^A-Za-z0-9._/-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/[-./_]+$/, "")
    .slice(0, 64);
}

const SUFFIX = /^(.*\S)-(\d{1,4})$/;

function valueOf(source: FieldSource, row: string[]): string {
  switch (source.kind) {
    case "column":
      return (row[source.column] ?? "").trim();
    case "constant":
      return source.value.trim();
    case "template":
      return source.template
        .replace(/\{(\d{1,3})\}/g, (_, i: string) => (row[Number(i)] ?? "").trim())
        .replace(/\s{2,}/g, " ")
        .trim();
    default:
      return "";
  }
}

/**
 * A cell to the JSON the attribute validator expects: yes/no words become a
 * boolean, `a|b` a list (multi-option), anything else stays text (option keys,
 * and numbers / measurements, which the database accepts as numeric strings).
 */
export function attributeValue(raw: string): AttributeValue | null {
  const v = normalizeAttributeText(raw);
  if (!v) return null;
  if (/^(true|yes|نعم)$/i.test(v)) return true;
  if (/^(false|no|لا)$/i.test(v)) return false;
  if (v.includes("|")) return v.split("|").map((x) => x.trim()).filter(Boolean);
  return v;
}

function normalizeAttributeText(raw: string) {
  const v = (raw ?? "").trim();
  return /^[0-9٠-٩۰-۹.,٫٬\s]+$/.test(v) ? normalizeNumber(v) : v;
}

const ATTR_KEY = /^[a-z][a-z0-9_]{0,63}$/;

/** `attr:<key>` headers → column index. */
export function attributeColumns(header: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  header.forEach((h, i) => {
    const m = /^(?:attr|attribute):\s*([a-z][a-z0-9_]*)$/i.exec((h ?? "").trim());
    if (m && ATTR_KEY.test(m[1]!.toLowerCase())) out.set(m[1]!.toLowerCase(), i);
  });
  return out;
}

export function parseFixedAttributes(text: string | undefined): Map<string, AttributeValue> {
  const out = new Map<string, AttributeValue>();
  for (const line of (text ?? "").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i < 1) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = attributeValue(line.slice(i + 1));
    if (ATTR_KEY.test(key) && value !== null) out.set(key, value);
  }
  return out;
}

export function buildPlan(grid: SheetGrid, config: ImportConfig): ImportPlan {
  const attrColumns = attributeColumns(grid[config.headerRow] ?? []);
  const fixed = parseFixedAttributes(config.fixedAttributes);
  const rows: PlannedRow[] = [];
  const rejected: LocalIssue[] = [];
  const warnings: LocalIssue[] = [];
  const data = grid.slice(config.headerRow + 1);

  // first pass: codes, so grouping can see every code of the file
  const codes = data.map((r) => valueOf(config.fields.code, r));
  const baseCount = new Map<string, number>();
  if (config.groupBySuffix) {
    for (const c of codes) {
      const m = SUFFIX.exec(c);
      if (m) baseCount.set(m[1]!, (baseCount.get(m[1]!) ?? 0) + 1);
    }
  }

  const skuOwner = new Map<string, string>();
  data.forEach((r, i) => {
    const row_number = config.headerRow + 2 + i; // the spreadsheet's own 1-based row number
    if (r.every((cell) => !cell || !cell.trim())) return; // blank line
    const code = codes[i] ?? "";
    if (!code) {
      rejected.push({ row_number, code: "code_missing", field: "code" });
      return;
    }
    const price = normalizeNumber(valueOf(config.fields.price, r));
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(price) || Number(price) <= 0) {
      rejected.push({ row_number, code: price === "" ? "price_missing" : "price_invalid", field: "price", detail: price });
      return;
    }
    const quantityRaw = config.fields.quantity.kind === "none" ? "" : normalizeNumber(valueOf(config.fields.quantity, r));
    if (quantityRaw !== "" && !/^\d{1,6}$/.test(quantityRaw)) {
      rejected.push({ row_number, code: "quantity_invalid", field: "quantity", detail: quantityRaw });
      return;
    }
    const sku = normalizeSku(code);
    if (!sku) {
      rejected.push({ row_number, code: "sku_unusable", field: "sku", detail: code });
      return;
    }
    const owner = skuOwner.get(sku.toLowerCase());
    if (owner !== undefined && owner !== code) {
      rejected.push({ row_number, code: "sku_collision", field: "sku", detail: `${code} → ${sku} (${owner})` });
      return;
    }
    skuOwner.set(sku.toLowerCase(), code);

    const m = config.groupBySuffix ? SUFFIX.exec(code) : null;
    const base = m && (baseCount.get(m[1]!) ?? 0) >= 2 ? m[1]! : code;
    const external_ref = normalizeSku(base).slice(0, 80) || sku;

    const planned: PlannedRow = {
      row_number,
      source_code: code,
      external_ref,
      sku,
      product_type: valueOf(config.fields.product_type, r).toLowerCase(),
      name_ar: valueOf(config.fields.name_ar, r).slice(0, 200),
      name_en: valueOf(config.fields.name_en, r).slice(0, 200),
      selling_unit: valueOf(config.fields.selling_unit, r).toLowerCase(),
      price,
      attributes: Object.fromEntries(fixed),
    };
    for (const [key, col] of attrColumns) {
      const v = attributeValue(r[col] ?? "");
      if (v !== null) planned.attributes[key] = v;
    }
    const optional: [TargetField, keyof PlannedRow][] = [
      ["description_ar", "description_ar"],
      ["description_en", "description_en"],
      ["brand", "brand"],
    ];
    for (const [f, k] of optional) {
      const v = valueOf(config.fields[f], r);
      if (v) (planned as Record<string, unknown>)[k] = v;
    }
    if (quantityRaw !== "") planned.quantity = quantityRaw;
    if (!planned.name_ar) warnings.push({ row_number, code: "name_ar_missing", field: "name_ar" });
    if (!planned.name_en) warnings.push({ row_number, code: "name_en_missing", field: "name_en" });
    if (!planned.product_type) warnings.push({ row_number, code: "product_type_missing", field: "product_type" });
    if (sku !== code) warnings.push({ row_number, code: "sku_normalized", field: "sku", detail: `${code} → ${sku}` });
    rows.push(planned);
  });

  const perProduct = new Map<string, number>();
  for (const r of rows) perProduct.set(r.external_ref, (perProduct.get(r.external_ref) ?? 0) + 1);
  return {
    rows,
    rejected,
    warnings,
    products: perProduct.size,
    variantRows: rows.length,
    singleVariantProducts: [...perProduct.values()].filter((n) => n === 1).length,
  };
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export type ImageCandidate = { fileName: string; size: number };

export type ImageMatch = {
  fileName: string;
  /** The name registered with the import (`<SKU or ref>_<NN>.<ext>`), which the database matches deterministically. */
  registeredName: string;
  target: "variant" | "product";
  sku: string | null;
  externalRef: string;
  sequence: number;
  extension: "jpg" | "png" | "webp";
};

export type ImageMatchResult = { matched: ImageMatch[]; unmatched: string[]; unsupported: string[]; tooLarge: string[] };

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const IMAGE_NAME = /^(.+?)(?:[_ ](\d{1,3}))?\.(jpe?g|png|webp)$/i;

/** Lower-cased lookup keys for a code: as written, normalised, and with spaces → `-`. */
function keys(s: string) {
  const t = s.trim().toLowerCase();
  return new Set([t, normalizeSku(s).toLowerCase(), t.replace(/\s+/g, "-")]);
}

/**
 * Matches image files to planned rows by NAME only (never by guessing):
 * `<code or SKU>[_NN].jpg` → that variant; `<product reference>[_NN].jpg` → the
 * product. Folders inside a ZIP are ignored. Anything else is reported unmatched.
 */
export function matchImages(files: ImageCandidate[], rows: PlannedRow[]): ImageMatchResult {
  const bySku = new Map<string, PlannedRow>();
  const byRef = new Map<string, PlannedRow>();
  for (const r of rows) {
    for (const k of keys(r.source_code)) if (!bySku.has(k)) bySku.set(k, r);
    for (const k of keys(r.sku)) if (!bySku.has(k)) bySku.set(k, r);
    for (const k of keys(r.external_ref)) if (!byRef.has(k)) byRef.set(k, r);
  }
  const result: ImageMatchResult = { matched: [], unmatched: [], unsupported: [], tooLarge: [] };
  const taken = new Set<string>();
  for (const f of [...files].sort((a, b) => a.fileName.localeCompare(b.fileName))) {
    const base = f.fileName.split(/[\\/]/).pop() ?? f.fileName;
    const m = IMAGE_NAME.exec(base);
    if (!m) {
      result.unsupported.push(f.fileName);
      continue;
    }
    if (f.size > MAX_IMAGE_BYTES) {
      result.tooLarge.push(f.fileName);
      continue;
    }
    const stem = m[1]!;
    const sequence = m[2] ? Number(m[2]) : 1;
    const ext = m[3]!.toLowerCase().replace("jpeg", "jpg") as ImageMatch["extension"];
    let row: PlannedRow | undefined;
    let target: ImageMatch["target"] = "variant";
    for (const k of keys(stem)) {
      row = bySku.get(k);
      if (row) break;
    }
    // a product with ONE variant: its images belong to the product, not the variant
    if (!row) {
      for (const k of keys(stem)) {
        row = byRef.get(k);
        if (row) {
          target = "product";
          break;
        }
      }
    }
    if (!row || sequence < 1) {
      result.unmatched.push(f.fileName);
      continue;
    }
    const prefix = target === "variant" ? row.sku : row.external_ref;
    const registeredName = `${prefix}_${String(sequence).padStart(2, "0")}.${ext}`;
    if (taken.has(registeredName.toLowerCase())) {
      result.unmatched.push(f.fileName);
      continue;
    }
    taken.add(registeredName.toLowerCase());
    result.matched.push({
      fileName: f.fileName,
      registeredName,
      target,
      sku: target === "variant" ? row.sku : null,
      externalRef: row.external_ref,
      sequence,
      extension: ext,
    });
  }
  return result;
}

/** Splits an array into chunks of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
