/**
 * Phase 0D — Command Palette matching. Pure and framework-free (unit-tested).
 *
 * The Preview palette deliberately has NO server-side search: it filters the
 * rows the Preview already loaded through existing queries (Users,
 * Organizations, Review queue, Admin Staff) plus local navigation definitions
 * and isolated fixtures. Real global Admin search — one server-side query over
 * every entity — is a later Admin Core backend item, not built here.
 */

export const PALETTE_GROUPS = ["users", "organizations", "reviews", "networkReferrals", "staff", "navigation"] as const;
export type PaletteGroup = (typeof PALETTE_GROUPS)[number];

export type PaletteItem = {
  id: string;
  group: PaletteGroup;
  label: string;
  /** Second line: type, requester, description… */
  secondary?: string;
  href: string;
};

export type PaletteResultGroup = { group: PaletteGroup; items: PaletteItem[] };

/** Lower-cases and strips Latin/Arabic diacritics so "Ahmed", "ahmed" and "Ahméd" match one another. */
export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ًͯ-ٰٟ]/g, "")
    .toLowerCase()
    .trim();
}

/** 0 = no match; higher is better. A prefix beats a word-start beats a substring. */
export function scoreItem(item: PaletteItem, query: string): number {
  const q = normalizeForSearch(query);
  if (!q) return 1;
  const label = normalizeForSearch(item.label);
  const secondary = normalizeForSearch(item.secondary ?? "");
  if (label.startsWith(q)) return 100;
  if (label.split(/[\s·\-–—/()]+/).some((w) => w.startsWith(q))) return 80;
  if (label.includes(q)) return 60;
  if (secondary.includes(q)) return 30;
  return 0;
}

/**
 * Groups matching items in the fixed `PALETTE_GROUPS` order, best match first
 * inside a group, at most `limitPerGroup` per group. An empty query returns
 * navigation only — the palette then reads as a page switcher, not a data dump.
 */
export function searchPalette(items: readonly PaletteItem[], query: string, limitPerGroup = 5): PaletteResultGroup[] {
  const q = query.trim();
  const pool = q ? items : items.filter((i) => i.group === "navigation");
  const groups: PaletteResultGroup[] = [];
  for (const group of PALETTE_GROUPS) {
    const matches = pool
      .filter((i) => i.group === group)
      .map((item, index) => ({ item, index, score: scoreItem(item, q) }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, limitPerGroup)
      .map((m) => m.item);
    if (matches.length > 0) groups.push({ group, items: matches });
  }
  return groups;
}

/** The flat, in-display-order list keyboard navigation moves through. */
export function flattenResults(groups: readonly PaletteResultGroup[]): PaletteItem[] {
  return groups.flatMap((g) => g.items);
}

/** ArrowDown / ArrowUp with wrap-around; returns 0 for an empty list. */
export function moveActive(current: number, delta: 1 | -1, length: number): number {
  if (length <= 0) return 0;
  return (current + delta + length) % length;
}
