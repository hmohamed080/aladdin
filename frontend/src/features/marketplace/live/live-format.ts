import type { Locale } from "../marketplace-types";
import { fmtNum, liveCopy } from "./live-copy";
import type { AttrValue, PublicAttribute } from "./public-contract";

/** A bilingual name in the shown language, falling back to the other one when it is empty. */
export function labelOf(o: { name_ar: string; name_en: string }, locale: Locale): string {
  return (locale === "ar" ? o.name_ar : o.name_en) || o.name_ar || o.name_en;
}

/** The shown text of one attribute value (option name, number with its unit, yes/no, free text). */
export function attributeText(a: PublicAttribute, locale: Locale): string {
  const v: AttrValue = a.value;
  const t = liveCopy[locale];
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? t.yes : t.no;
  if (typeof v === "number") {
    const unit = locale === "ar" ? a.unit_ar : a.unit_en;
    return unit ? `${fmtNum(v, locale)} ${unit}` : fmtNum(v, locale);
  }
  if (typeof v === "string") return v;
  return labelOf(v, locale);
}

/** The swatch colour of an option-valued attribute (e.g. a colour), when it has one. */
export function attributeSwatch(a: PublicAttribute): string | null {
  const v = a.value;
  return v !== null && typeof v === "object" ? v.swatch_hex : null;
}
