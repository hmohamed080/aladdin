import { MIB } from "./upload-limits";

/**
 * Admin-configurable media upload limits (owner decision 2026-11-21; migration
 * 20261121090002_media_limits_admin.sql). PURE: the browser, the server and the admin page share it.
 *
 * Authority order: the STORED value (table `media_limits`, enforced by the database on the
 * verification receipt and on new video rows, and read by the server before it issues an upload
 * grant) > these compiled defaults, which only apply when the stored value cannot be read. The
 * browser gets the stored value as a HINT; it can only make the UI friendlier, never loosen a check.
 *
 * The ceilings and floors mirror the database CHECK constraints: a value outside them cannot be
 * stored, whatever an administrator types.
 */
export const IMAGE_PLACES = ["avatar", "organization", "portfolio", "certificate", "product", "request", "verification", "marketplace"] as const;
export const VIDEO_PLACES = ["portfolio", "product"] as const;
export type ImagePlace = (typeof IMAGE_PLACES)[number];
export type VideoPlace = (typeof VIDEO_PLACES)[number];
export type MediaKind = "image" | "video";

/** What the platform can carry: image decode memory / 25 MP pixel budget, transcode worker disk and time. */
export const MEDIA_LIMIT_CEILING: Readonly<Record<MediaKind, number>> = { image: 25 * MIB, video: 1024 * MIB };
/** Keeps a typo from locking a place out. */
export const MEDIA_LIMIT_FLOOR: Readonly<Record<MediaKind, number>> = { image: 100 * 1024, video: MIB };

export const DEFAULT_IMAGE_LIMITS: Readonly<Record<ImagePlace, number>> = {
  avatar: 3 * MIB, organization: 3 * MIB, portfolio: 10 * MIB, certificate: 10 * MIB,
  product: 10 * MIB, request: 10 * MIB, verification: 10 * MIB, marketplace: 10 * MIB,
};
export const DEFAULT_VIDEO_LIMITS: Readonly<Record<VideoPlace, number>> = { portfolio: 100 * MIB, product: 100 * MIB };

export type MediaLimitRow = {
  kind: MediaKind;
  place: string;
  maxBytes: number;
  defaultBytes: number;
  ceilingBytes: number;
  updatedAt: string | null;
};

export function isImagePlace(value: unknown): value is ImagePlace {
  return typeof value === "string" && (IMAGE_PLACES as readonly string[]).includes(value);
}
export function isVideoPlace(value: unknown): value is VideoPlace {
  return typeof value === "string" && (VIDEO_PLACES as readonly string[]).includes(value);
}

/** The compiled default of a place, or null when the place does not exist. */
export function defaultLimit(kind: MediaKind, place: string): number | null {
  if (kind === "image") return isImagePlace(place) ? DEFAULT_IMAGE_LIMITS[place] : null;
  return isVideoPlace(place) ? DEFAULT_VIDEO_LIMITS[place] : null;
}

/** The ceiling-clamped value in force for a place: the stored one when present and sane, else the default. */
export function resolveLimit(rows: readonly MediaLimitRow[] | null | undefined, kind: MediaKind, place: string): number {
  const fallback = defaultLimit(kind, place) ?? MEDIA_LIMIT_FLOOR[kind];
  const row = rows?.find((r) => r.kind === kind && r.place === place);
  if (!row || !Number.isSafeInteger(row.maxBytes) || row.maxBytes <= 0) return fallback;
  return Math.min(Math.max(row.maxBytes, MEDIA_LIMIT_FLOOR[kind]), MEDIA_LIMIT_CEILING[kind]);
}

export type LimitInputError = "unknown_place" | "not_a_number" | "above_ceiling" | "below_floor";

/** Client/server pre-check of a value an administrator typed; the database re-checks the same rules. */
export function validateLimitInput(kind: MediaKind, place: string, bytes: number): { ok: true } | { ok: false; code: LimitInputError } {
  if (defaultLimit(kind, place) === null) return { ok: false, code: "unknown_place" };
  if (!Number.isSafeInteger(bytes)) return { ok: false, code: "not_a_number" };
  if (bytes > MEDIA_LIMIT_CEILING[kind]) return { ok: false, code: "above_ceiling" };
  if (bytes < MEDIA_LIMIT_FLOOR[kind]) return { ok: false, code: "below_floor" };
  return { ok: true };
}

/** The rows of `media_limits_get`, or an empty list when the payload is not what was expected. */
export function parseLimitRows(data: unknown): MediaLimitRow[] {
  if (!Array.isArray(data)) return [];
  const rows: MediaLimitRow[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const kind = r.kind;
    if (kind !== "image" && kind !== "video") continue;
    const max = Number(r.max_bytes ?? r.maxBytes);
    const def = Number(r.default_bytes ?? r.defaultBytes);
    const ceiling = Number(r.ceiling_bytes ?? r.ceilingBytes);
    if (typeof r.place !== "string" || !Number.isSafeInteger(max) || !Number.isSafeInteger(def) || !Number.isSafeInteger(ceiling)) continue;
    rows.push({ kind, place: r.place, maxBytes: max, defaultBytes: def, ceilingBytes: ceiling, updatedAt: typeof (r.updated_at ?? r.updatedAt) === "string" ? String(r.updated_at ?? r.updatedAt) : null });
  }
  return rows;
}

/** "10 MB" / "512 KB" for a byte count (binary units, shown as MB as the product copy does). */
export function formatLimit(bytes: number): string {
  if (bytes >= 1024 * MIB && bytes % (1024 * MIB) === 0) return `${bytes / (1024 * MIB)} GB`;
  if (bytes >= MIB) return `${Number((bytes / MIB).toFixed(bytes % MIB === 0 ? 0 : 1))} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
