/**
 * Admin date entry — pure logic (unit-tested). The Admin standard is
 * DD/MM/YYYY. A native `<input type="date">` cannot guarantee that: it renders
 * in the BROWSER's locale order (US browsers show `mm/dd/yyyy`), which is an
 * ambiguous entry format for an Egypt-focused Admin. `AdminDateInput` therefore
 * uses a text field driven by these helpers, and exchanges ISO `YYYY-MM-DD`
 * with the rest of the app.
 */

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EASTERN_PERSIAN = "۰۱۲۳۴۵۶۷۸۹";

/** Arabic-Indic / Eastern Arabic-Indic digits → ASCII, so a typed value parses in either locale. */
export function toAsciiDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (ch) => {
    const a = ARABIC_INDIC.indexOf(ch);
    return String(a >= 0 ? a : EASTERN_PERSIAN.indexOf(ch));
  });
}

/**
 * Live input mask: keeps digits only (max 8) and inserts the slashes,
 * so typing `29092026` reads `29/09/2026`. Backspacing through a slash works
 * because the slash is re-derived from the digits, never stored.
 */
export function maskAdminDate(raw: string): string {
  const digits = toAsciiDigits(raw).replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** `DD/MM/YYYY` (also `-` `.` separators, 1-digit day/month) → ISO `YYYY-MM-DD`, or null when not a REAL calendar date. */
export function parseAdminDate(text: string): string | null {
  const m = toAsciiDigits(text).trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** ISO `YYYY-MM-DD` → `DD/MM/YYYY` ("" for anything that is not an ISO day). */
export function formatAdminDateInput(iso: string | null | undefined): string {
  const m = (iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

export type AdminDateState =
  | { status: "empty" }
  | { status: "incomplete" }
  | { status: "invalid" }
  | { status: "afterMax" }
  | { status: "valid"; iso: string };

/** Classifies what the user has typed so far; `max` is an inclusive ISO upper bound. */
export function classifyAdminDate(text: string, max?: string): AdminDateState {
  const t = text.trim();
  if (t === "") return { status: "empty" };
  if (toAsciiDigits(t).replace(/\D/g, "").length < 8) return { status: "incomplete" };
  const iso = parseAdminDate(t);
  if (!iso) return { status: "invalid" };
  if (max && iso > max) return { status: "afterMax" };
  return { status: "valid", iso };
}

/** 24-hour time mask: digits only (max 4), colon inserted — `1430` reads `14:30`. */
export function maskAdminTime(raw: string): string {
  const digits = toAsciiDigits(raw).replace(/\D/g, "").slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

/** `empty` | `incomplete` | `invalid` (hour > 23 or minute > 59) | `valid`. */
export function classifyAdminTime(text: string): "empty" | "incomplete" | "invalid" | "valid" {
  const t = text.trim();
  if (t === "") return "empty";
  const digits = toAsciiDigits(t).replace(/\D/g, "");
  if (digits.length >= 2 && Number(digits.slice(0, 2)) > 23) return "invalid";
  if (digits.length < 4) return "incomplete";
  return Number(digits.slice(2, 4)) > 59 ? "invalid" : "valid";
}
