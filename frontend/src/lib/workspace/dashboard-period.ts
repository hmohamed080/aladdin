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
 * WHY CAIRO IS HARDCODED
 * No organization/branch timezone concept exists anywhere in this schema, and
 * the product is Egypt-only today (see AGENTS.md). Building a general
 * per-organization timezone system for one dashboard's "this month"/"this
 * quarter" boundaries would be speculative infrastructure ahead of a real
 * second market. `DASHBOARD_TIMEZONE` is the single point that assumption
 * lives, so it is also the single point to change if that ever stops being true.
 */
export const DASHBOARD_TIMEZONE = "Africa/Cairo";

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

/** Inclusive `yyyy-mm-dd` window, in the Cairo calendar, ready to hand to `ReportFilters`. */
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

/** `y/m/d` in the Cairo calendar for an instant — correct across any DST history that zone has had or will have, via ICU's tz database rather than a hardcoded offset. */
function cairoParts(date: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DASHBOARD_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/**
 * The UTC instant of Cairo-local midnight on `y-m-d`.
 *
 * Standard "round-trip through Intl" technique: guess the instant as if Cairo
 * had no offset, read back what that instant actually reads as in Cairo, then
 * correct by the difference. Avoids hardcoding a UTC+2/+3 offset, which would
 * silently go wrong the moment Egypt's DST policy changes again.
 */
function cairoMidnightUTC(y: number, m: number, d: number): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: DASHBOARD_TIMEZONE,
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

function addDaysISO(y: number, m: number, d: number, days: number): { y: number; m: number; d: number } {
  const t = cairoMidnightUTC(y, m, d);
  const shifted = new Date(t.getTime() + days * 86_400_000);
  return cairoParts(shifted);
}

/**
 * Resolve a period key into an inclusive Cairo-calendar `[from, to]` window,
 * as `yyyy-mm-dd` strings — the exact shape `ReportFilters` already accepts.
 *
 * `now` is a parameter (not read internally) so callers — and tests — control
 * "today" rather than every call being pinned to the real clock.
 */
export function dashboardPeriodRange(
  key: DashboardPeriodKey,
  now: Date,
  custom?: { from: string; to: string },
): DashboardPeriodRange {
  const today = cairoParts(now);

  if (key === "7d" || key === "30d" || key === "90d") {
    const start = addDaysISO(today.y, today.m, today.d, -(ROLLING_DAYS[key] - 1));
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
  return dashboardPeriodRange(DEFAULT_DASHBOARD_PERIOD, now);
}

/**
 * The immediately preceding window of the same length — what "حركة السوق"
 * and any other period-over-period comparison measure against. Calendar
 * periods (`thisMonth`/`thisQuarter`) compare against the previous calendar
 * unit, not a naive day-count shift, so "this month" vs "last month" holds
 * even though months are not equal length.
 */
export function previousDashboardPeriodRange(range: DashboardPeriodRange): DashboardPeriodRange {
  if (range.key === "thisMonth") {
    const [y, m] = range.from.split("-").map(Number) as [number, number];
    const prevMonth = m === 1 ? 12 : m - 1;
    const prevYear = m === 1 ? y - 1 : y;
    const daysInto = Number(range.to.slice(8, 10));
    const prevEnd = addDaysISO(prevYear, prevMonth, 1, daysInto - 1);
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
    const daysInto = daysBetweenISO(range.from, range.to);
    const prevStart = addDaysISO(prevYear, prevQuarterStartMonth, 1, 0);
    const prevEnd = addDaysISO(prevStart.y, prevStart.m, prevStart.d, daysInto);
    return {
      key: "thisQuarter",
      from: toISODate(prevStart.y, prevStart.m, prevStart.d),
      to: toISODate(prevEnd.y, prevEnd.m, prevEnd.d),
    };
  }
  // Rolling and custom windows: shift the whole window back by its own length.
  const lengthDays = daysBetweenISO(range.from, range.to) + 1;
  const [fy, fm, fd] = range.from.split("-").map(Number) as [number, number, number];
  const prevEnd = addDaysISO(fy, fm, fd, -1);
  const prevStart = addDaysISO(prevEnd.y, prevEnd.m, prevEnd.d, -(lengthDays - 1));
  return {
    key: range.key,
    from: toISODate(prevStart.y, prevStart.m, prevStart.d),
    to: toISODate(prevEnd.y, prevEnd.m, prevEnd.d),
  };
}

function daysBetweenISO(fromISO: string, toISO: string): number {
  const [fy, fm, fd] = fromISO.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = toISO.split("-").map(Number) as [number, number, number];
  const from = cairoMidnightUTC(fy, fm, fd);
  const to = cairoMidnightUTC(ty, tm, td);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}
