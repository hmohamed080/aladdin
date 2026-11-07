/** Display estimate only; the private runner makes the authoritative due decision. */
export function nextBackupAt(settings: {
  acceptance_schedule: "off" | "daily" | "weekly";
  schedule_time: string; schedule_weekday: number; paused_until: string | null;
  production_enabled: boolean;
}, environment: "acceptance" | "production", now = new Date()): string | null {
  if (settings.acceptance_schedule === "off" || (environment === "production" && !settings.production_enabled)) return null;
  const from = Math.max(now.getTime(), settings.paused_until ? Date.parse(settings.paused_until) : 0);
  if (!Number.isFinite(from)) return null;
  const format = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hourCycle: "h23",
    hour: "2-digit", minute: "2-digit", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" });
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (let stamp = Math.ceil(from / 60000) * 60000; stamp < from + 8 * 86400000; stamp += 60000) {
    const parts = Object.fromEntries(format.formatToParts(stamp).map(p => [p.type, p.value]));
    if (settings.acceptance_schedule === "weekly" && parts.weekday !== weekdays[settings.schedule_weekday]) continue;
    if (`${parts.hour}:${parts.minute}` === settings.schedule_time.slice(0,5)) return new Date(stamp).toISOString();
  }
  return null;
}
