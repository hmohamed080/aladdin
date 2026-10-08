/**
 * "DATE RANGE" ON MY WORK MEANS THE PLANNED WORK WINDOW — `starts_on` → `ends_by`.
 *
 * Not delivery only, and not when the record was created. An assignment is
 * included when the period it is planned to run over overlaps the selected range:
 *
 *   starts_on + ends_by  -> the two intervals overlap
 *   starts_on only       -> that known start falls inside the range
 *   ends_by only         -> that known end falls inside the range
 *   neither              -> excluded, but ONLY while a date filter is selected
 *
 * Either bound of the range may be empty (open-ended). Dates are ISO
 * `YYYY-MM-DD` strings, which order correctly as plain strings, so nothing here
 * constructs a `Date` and nothing depends on the viewer's time zone.
 */

export type PlannedWindow = { startsOn: string | null; endsBy: string | null };
export type DateRangeBounds = { from: string; to: string };

const day = (value: string | null): string | null => (value ? value.slice(0, 10) : null);

export function hasDateFilter(range: DateRangeBounds): boolean {
  return Boolean(range.from || range.to);
}

export function overlapsPlannedWindow(window: PlannedWindow, range: DateRangeBounds): boolean {
  if (!hasDateFilter(range)) return true;
  const start = day(window.startsOn);
  const end = day(window.endsBy);
  if (!start && !end) return false;

  const lo = start ?? end!;
  const hi = end ?? start!;
  // A reversed window (end before start) is treated as the interval it spans.
  const from = lo <= hi ? lo : hi;
  const to = lo <= hi ? hi : lo;

  const startsBeforeRangeEnds = !range.to || from <= range.to;
  const endsAfterRangeStarts = !range.from || to >= range.from;
  return startsBeforeRangeEnds && endsAfterRangeStarts;
}
