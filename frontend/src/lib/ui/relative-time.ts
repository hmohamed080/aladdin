const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** `5 minutes ago` / `قبل 5 دقائق`; under a minute is `now`. Future or invalid values read as now. */
export function relativeTime(iso: string | null | undefined, locale: "ar" | "en", now = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const then = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(then)) return rtf.format(0, "second");
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  for (const [unit, size] of STEPS) {
    if (seconds >= size) return rtf.format(-Math.floor(seconds / size), unit);
  }
  return rtf.format(0, "second");
}
