/**
 * A curated IANA timezone list for the org/branch settings selects — not
 * exhaustive (the full `pg_timezone_names` list is ~600 entries, unusable in
 * a plain dropdown), but every value here IS a real IANA identifier the
 * server-side `app.validate_iana_timezone()` trigger accepts. Egypt-relevant
 * zones lead the list since the product is Egypt-only today; the rest cover
 * the regions Aladdin's own organizations most plausibly operate or trade
 * across.
 */
export const TIMEZONE_OPTIONS: readonly string[] = [
  "Africa/Cairo",
  "Africa/Casablanca",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Asia/Riyadh",
  "Asia/Dubai",
  "Asia/Kuwait",
  "Asia/Baghdad",
  "Asia/Amman",
  "Asia/Beirut",
  "Europe/Istanbul",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "UTC",
];
