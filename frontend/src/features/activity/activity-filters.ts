import {
  normalizeActivityFilters,
  type ActivityFilterInput,
  type ActivityFilters,
} from "@/lib/activity";

type ActivitySearchState = ActivityFilterInput & { before?: string };

function buildActivityHref(filters: ActivityFilters, before?: string): string {
  const query = new URLSearchParams();
  if (filters.family) query.set("family", filters.family);
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);
  if (before) query.set("before", before);

  const search = query.toString();
  return search ? `/b2b/activity?${search}` : "/b2b/activity";
}

export function activityFilterHref(
  current: ActivitySearchState,
  patch: Partial<ActivityFilters>,
): string {
  const next: ActivityFilterInput = { ...normalizeActivityFilters(current) };

  for (const key of ["family", "from", "to"] as const) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value) next[key] = value;
    else delete next[key];
  }

  // A filter change intentionally omits `before`: a cursor belongs only to the
  // exact predicate set that produced it.
  return buildActivityHref(normalizeActivityFilters(next));
}

export function activityPageHref(filters: ActivityFilterInput, before: string): string {
  return buildActivityHref(normalizeActivityFilters(filters), before);
}
