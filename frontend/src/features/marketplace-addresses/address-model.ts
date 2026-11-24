import { z } from "zod";
import { CITIES_BY_GOVERNORATE, GOVERNORATE_OPTIONS } from "@/lib/installer/location-data";
import type { BuyerPlace } from "@/features/marketplace/live/public-contract";

/**
 * Pure model of a saved buyer address (Marketplace PR 10). The database is the authority (see
 * 20261124100001_marketplace_buyer_addresses.sql); this file mirrors its limits so the form can refuse early and word the
 * result, and maps a saved address onto the place the delivery estimate already understands.
 *
 * Personal data: nothing here logs, and no value of an address is ever placed in a URL.
 */

export const ADDRESS_KINDS = ["home", "work", "other"] as const;
export type AddressKind = (typeof ADDRESS_KINDS)[number];
export const MAX_ADDRESSES = 10;
export const LOCATION_SOURCES = ["manual", "catalogue", "map"] as const;
export type LocationSource = (typeof LOCATION_SOURCES)[number];

/** A saved address as `marketplace_buyer_addresses()` returns it. */
export type SavedAddress = {
  id: string;
  kind: AddressKind;
  nickname: string | null;
  governorate_key: string;
  area_key: string | null;
  district: string | null;
  street: string;
  building: string | null;
  floor_apartment: string | null;
  directions: string | null;
  latitude: number | null;
  longitude: number | null;
  location_source: LocationSource;
  recipient_first_name: string;
  recipient_last_name: string;
  recipient_phone_e164: string;
  /** Derived by the database from the phone verification authority's proof; never set by the client. */
  recipient_phone_verified: boolean;
  is_default: boolean;
  created_at: string;
};

/** Egypt bounding box, the same as the database check; a pin outside it is a mistake. */
export const EGYPT_BOUNDS = { latMin: 21.5, latMax: 31.95, lngMin: 24.5, lngMax: 37.0 } as const;

const govKeys = new Set(GOVERNORATE_OPTIONS.map((g) => g.value));
const text = (max: number) => z.string().trim().max(max).refine((v) => !/[\u0000-\u001f\u007f]/.test(v), "invalid_characters");
const optionalText = (max: number) => text(max).optional().transform((v) => (v === undefined || v === "" ? null : v));
const optionalCoordinate = z
  .union([z.number(), z.string()])
  .nullable()
  .optional()
  .transform((v) => (v === null || v === undefined || v === "" ? null : Number(v)))
  .refine((v) => v === null || Number.isFinite(v), "invalid_pin");

export const addressDraftSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(ADDRESS_KINDS),
    nickname: optionalText(40),
    governorate_key: z.string().refine((v) => govKeys.has(v), "unknown_governorate"),
    area_key: z.string().trim().max(64).transform((v) => (v === "" ? null : v)).nullable().optional().transform((v) => v ?? null),
    district: optionalText(80),
    street: text(160).refine((v) => v.length >= 3, "street_short"),
    building: optionalText(40),
    floor_apartment: optionalText(40),
    directions: optionalText(200),
    latitude: optionalCoordinate,
    longitude: optionalCoordinate,
    location_source: z.enum(LOCATION_SOURCES).default("manual"),
    recipient_first_name: text(40).refine((v) => v.length >= 1, "name_required"),
    recipient_last_name: text(40).refine((v) => v.length >= 1, "name_required"),
    recipient_phone_e164: z.string().regex(/^\+[1-9]\d{1,14}$/, "invalid_phone"),
    make_default: z.boolean().optional().default(false),
  })
  .superRefine((a, ctx) => {
    if (a.area_key && !(CITIES_BY_GOVERNORATE[a.governorate_key] ?? []).some((c) => c.value === a.area_key)) {
      ctx.addIssue({ code: "custom", path: ["area_key"], message: "unknown_area" });
    }
    const hasLat = a.latitude !== null;
    const hasLng = a.longitude !== null;
    if (hasLat !== hasLng) ctx.addIssue({ code: "custom", path: ["latitude"], message: "invalid_pin" });
    if (hasLat && hasLng) {
      const { latMin, latMax, lngMin, lngMax } = EGYPT_BOUNDS;
      if ((a.latitude as number) < latMin || (a.latitude as number) > latMax || (a.longitude as number) < lngMin || (a.longitude as number) > lngMax) {
        ctx.addIssue({ code: "custom", path: ["latitude"], message: "pin_outside_egypt" });
      }
    }
    if (a.location_source === "map" && !hasLat) ctx.addIssue({ code: "custom", path: ["latitude"], message: "invalid_pin" });
  });

export type AddressDraft = z.input<typeof addressDraftSchema>;
export type ValidAddress = z.output<typeof addressDraftSchema>;

/** Validation issue code -> the short field name under `buyerAddresses.field.*` (and the form field it belongs to). */
export const ISSUE_FIELD: Record<string, string> = {
  street_short: "street",
  name_required: "name",
  invalid_phone: "phone",
  unknown_governorate: "governorate",
  unknown_area: "area",
  invalid_pin: "pin",
  pin_outside_egypt: "pinOutside",
  invalid_characters: "characters",
};

/** First failing field, so the form can show one precise message instead of a wall of errors. */
export function firstAddressIssue(draft: unknown): { field: string } | null {
  const r = addressDraftSchema.safeParse(draft);
  if (r.success) return null;
  const i = r.error.issues[0];
  return { field: ISSUE_FIELD[i?.message ?? ""] ?? "characters" };
}

/**
 * The place a saved address stands for, in the form the delivery estimate already takes (`BuyerPlace`: the same governorate and
 * area keys showrooms use for their delivery areas). An area not in the catalogue collapses to the governorate.
 */
export function toBuyerPlace(a: Pick<SavedAddress, "governorate_key" | "area_key">): BuyerPlace {
  const areaOk = !!a.area_key && (CITIES_BY_GOVERNORATE[a.governorate_key] ?? []).some((c) => c.value === a.area_key);
  return { gov: a.governorate_key, area: areaOk ? (a.area_key as string) : "" };
}

/** Governorate and area names in the shown language, "Maadi, Cairo". */
export function placeLabel(a: Pick<SavedAddress, "governorate_key" | "area_key">, locale: "ar" | "en"): string {
  const pick = (o: { ar: string; en: string } | undefined, fallback: string) => (o ? (locale === "ar" ? o.ar : o.en) : fallback);
  const gov = pick(GOVERNORATE_OPTIONS.find((g) => g.value === a.governorate_key), a.governorate_key);
  const area = a.area_key ? pick((CITIES_BY_GOVERNORATE[a.governorate_key] ?? []).find((c) => c.value === a.area_key), a.area_key) : null;
  return area ? `${area}${locale === "ar" ? "، " : ", "}${gov}` : gov;
}

/** A one-line street summary: "12 Street, building 4, floor/apartment 3". Order and wording belong to the caller's labels. */
export function streetLine(a: Pick<SavedAddress, "street" | "building" | "floor_apartment" | "district">, labels: { building: string; floorApartment: string }): string {
  return [a.street, a.district, a.building ? `${labels.building} ${a.building}` : null, a.floor_apartment ? `${labels.floorApartment} ${a.floor_apartment}` : null]
    .filter((p): p is string => !!p)
    .join("، ");
}

/** Last two digits only, so a number can be recognised on screen without being repeated in full. */
export function maskPhone(e164: string): string {
  return e164.length > 4 ? `${e164.slice(0, 3)}${"•".repeat(Math.max(0, e164.length - 5))}${e164.slice(-2)}` : e164;
}

/**
 * What the buyer must do before this address can be used at checkout:
 * - "ready": the recipient mobile is the account's verified phone;
 * - "verify": it is the account's own phone and only the code is missing;
 * - "own_number_only": it is a different number, which this release cannot prove (the authority proves the account's own phone).
 */
export function phoneState(address: Pick<SavedAddress, "recipient_phone_e164" | "recipient_phone_verified">, accountPhone: string | null): "ready" | "verify" | "own_number_only" {
  if (address.recipient_phone_verified) return "ready";
  return accountPhone && accountPhone === address.recipient_phone_e164 ? "verify" : "own_number_only";
}

export function canAddAddress(count: number): boolean {
  return count < MAX_ADDRESSES;
}
