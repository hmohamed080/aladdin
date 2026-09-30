/**
 * A follow-up due time typed as a date (ISO from the DD/MM/YYYY field) and an
 * HH:mm time, read as Egypt time (Africa/Cairo) and handed to Postgres as a
 * zone-qualified timestamp literal. No date = no follow-up date. A missing time
 * defaults to 09:00. Anything malformed is "invalid" (an input error).
 */
export function parseDueAt(dateIso: string, time: string): string | null | "invalid" {
  if (!dateIso) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return "invalid";
  const hhmm = time || "09:00";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return "invalid";
  return `${dateIso} ${hhmm} Africa/Cairo`;
}
