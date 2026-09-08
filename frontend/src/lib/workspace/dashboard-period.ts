/**
 * The Showroom Owner dashboard's period scope, as data.
 *
 * WHY A SEPARATE MODULE FROM `lib/workspace/period.ts`
 * That module's vocabulary (30d/90d/365d/all) is the supply-side dashboard's own
 * — a different control, a different default, and a different set of options
 * (`m.supply.period`). Reusing its type here would mean either widening a
 * vocabulary a shipped surface already depends on, or narrowing this one to fit
 * it. Two small, honest vocabularies beat one that has to serve two different
 * option lists.
 *
 * TIMEZONE IS A CALLER-SUPPLIED PARAMETER, NOT A CONSTANT HERE
 * Every function below takes an IANA `timezone` string rather than assuming
 * one. The RESOLUTION of that string (active branch → organization →
 * `Africa/Cairo`) is a separate concern — see `lib/workspace/timezone.ts` —
 * because this module only needs to know how to bucket a period once a zone
 * has already been decided, not where that zone came from.
 */
export const DASHBOARD_TIMEZONE_FALLBACK = "Africa/Cairo";

export type DashboardPeriodKey = "7d" | "30d" | "90d" | "thisMonth" | "thisQuarter" | "custom";

/** The offered windows, in the order they are shown — shortest to longest, then the two calendar-aligned ones, then custom last. */
export const DASHBOARD_PERIOD_ORDER = [
  "7d",
  "30d",
  "90d",
  "thisMonth",
  "thisQuarter",
  "custom",
] as const satisfies readonly DashboardPeriodKey[];

export const DEFAULT_DASHBOARD_PERIOD: DashboardPeriodKey = "30d";

const ROLLING_DAYS: Record<"7d" | "30d" | "90d", number> = { "7d": 7, "30d": 30, "90d": 90 };

/** Inclusive `yyyy-mm-dd` window, in the resolved calendar, ready to hand to `ReportFilters`. */
export type DashboardPeriodRange = { key: DashboardPeriodKey; from: string; to: string };

/**
 * The URL is user input: anything not on the list is not a period. A `custom`
 * period additionally needs both `from` and `to` to be well-formed
 * `yyyy-mm-dd` and `from <= to` — a `custom` that fails that check falls back
 * exactly like an unrecognised key would, rather than silently swapping the
 * two dates or clamping one of them.
 */
export function resolveDashboardPeriod(
  rawKey: string | undefined,
  rawFrom: string | undefined,
  rawTo: string | undefined,
  fallback: DashboardPeriodKey = DEFAULT_DASHBOARD_PERIOD,
): DashboardPeriodKey {
  if (!rawKey || !(DASHBOARD_PERIOD_ORDER as readonly string[]).includes(rawKey)) return fallback;
  const key = rawKey as DashboardPeriodKey;
  if (key === "custom" && !isValidCustomRange(rawFrom, rawTo)) return fallback;
  return key;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidCustomRange(from: string | undefined, to: string | undefined): from is string {
  return !!from && !!to && ISO_DATE.test(from) && ISO_DATE.test(to) && from <= to;
}

/** `y/m/d` in `timezone` for an instant — correct across any DST history that zone has had or will have, via ICU's tz database rather than a hardcoded offset. */
function zonedParts(date: Date, timezone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/**
 * The UTC instant of local midnight on `y-m-d` in `timezone`.
 *
 * Standard "round-trip through Intl" technique: guess the instant as if the
 * zone had no offset, read back what that instant actually reads as in the
 * zone, then correct by the difference. Avoids hardcoding a fixed UTC offset,
 * which would silently go wrong the moment a zone's DST policy changes (as
 * Egypt's has, more than once).
 */
function zonedMidnightUTC(y: number, m: number, d: number, timezone: string): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(guess).map((p) => [p.type, p.value]));
  const readBackUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMs = readBackUTC - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
}

function toISODate(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addDaysISO(y: number, m: number, d: number, days: number, timezone: string): { y: number; m: number; d: number } {
  const t = zonedMidnightUTC(y, m, d, timezone);
  const shifted = new Date(t.getTime() + days * 86_400_000);
  return zonedParts(shifted, timezone);
}

/**
 * Resolve a period key into an inclusive `[from, to]` window in `timezone`,
 * as `yyyy-mm-dd` strings — the exact shape `ReportFilters` already accepts.
 *
 * `now` is a parameter (not read internally) so callers — and tests — control
 * "today" rather than every call being pinned to the real clock. `timezone`
 * is the caller's already-RESOLVED zone (branch → org → Africa/Cairo — see
 * `lib/workspace/timezone.ts`), not re-resolved here.
 */
export function dashboardPeriodRange(
  key: DashboardPeriodKey,
  now: Date,
  timezone: string,
  custom?: { from: string; to: string },
): DashboardPeriodRange {
  const today = zonedParts(now, timezone);

  if (key === "7d" || key === "30d" || key === "90d") {
    const start = addDaysISO(today.y, today.m, today.d, -(ROLLING_DAYS[key] - 1), timezone);
    return { key, from: toISODate(start.y, start.m, start.d), to: toISODate(today.y, today.m, today.d) };
  }

  if (key === "thisMonth") {
    return { key, from: toISODate(today.y, today.m, 1), to: toISODate(today.y, today.m, today.d) };
  }

  if (key === "thisQuarter") {
    const quarterStartMonth = Math.floor((today.m - 1) / 3) * 3 + 1;
    return {
      key,
      from: toISODate(today.y, quarterStartMonth, 1),
      to: toISODate(today.y, today.m, today.d),
    };
  }

  // "custom" — validated by resolveDashboardPeriod before this is ever called
  // with an untrusted pair, but a missing/invalid pair still degrades to the
  // default window rather than throwing, so a stale or hand-edited URL never
  // 500s the page.
  if (custom && isValidCustomRange(custom.from, custom.to)) {
    return { key: "custom", from: custom.from, to: custom.to };
  }
  return dashboardPeriodRange(DEFAULT_DASHBOARD_PERIOD, now, timezone);
}

/**
 * The immediately preceding window of the same length — what "حركة السوق"
 * and any other period-over-period comparison measure against. Calendar
 * periods (`thisMonth`/`thisQuarter`) compare against the previous calendar
 * unit, not a naive day-count shift, so "this month" vs "last month" holds
 * even though months are not equal length.
 */
export function previousDashboardPeriodRange(range: DashboardPeriodRange, timezone: string): DashboardPeriodRange {
  if (range.key === "thisMonth") {
    const [y, m] = range.from.split("-").map(Number) as [number, number];
    const prevMonth = m === 1 ? 12 : m - 1;
    const prevYear = m === 1 ? y - 1 : y;
    const daysInto = Number(range.to.slice(8, 10));
    const prevEnd = addDaysISO(prevYear, prevMonth, 1, daysInto - 1, timezone);
    return {
      key: "thisMonth",
      from: toISODate(prevYear, prevMonth, 1),
      to: toISODate(prevEnd.y, prevEnd.m, prevEnd.d),
    };
  }
  if (range.key === "thisQuarter") {
    const [y, m] = range.from.split("-").map(Number) as [number, number];
    const prevQuarterStartMonth = m === 1 ? 10 : m - 3;
    const prevYear = m === 1 ? y - 1 : y;
    const daysInto = daysBetweenISO(range.from, range.to, timezone);
    const prevStart = addDaysISO(prevYear, prevQuarterStartMonth, 1, 0, timezone);
    const prevEnd = addDaysISO(prevStart.y, prevStart.m, prevStart.d, daysInto, timezone);
    return {
      key: "thisQuarter",
      from: toISODate(prevStart.y, prevStart.m, prevStart.d),
      to: toISODate(prevEnd.y, prevEnd.m, prevEnd.d),
    };
  }
  // Rolling and custom windows: shift the whole window back by its own length.
  const lengthDays = daysBetweenISO(range.from, range.to, timezone) + 1;
  const [fy, fm, fd] = range.from.split("-").map(Number) as [number, number, number];
  const prevEnd = addDaysISO(fy, fm, fd, -1, timezone);
  const prevStart = addDaysISO(prevEnd.y, prevEnd.m, prevEnd.d, -(lengthDays - 1), timezone);
  return {
    key: range.key,
    from: toISODate(prevStart.y, prevStart.m, prevStart.d),
    to: toISODate(prevEnd.y, prevEnd.m, prevEnd.d),
  };
}

function daysBetweenISO(fromISO: string, toISO: string, timezone: string): number {
  const [fy, fm, fd] = fromISO.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = toISO.split("-").map(Number) as [number, number, number];
  const from = zonedMidnightUTC(fy, fm, fd, timezone);
  const to = zonedMidnightUTC(ty, tm, td, timezone);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}
