/**
 * Fail-closed environment isolation for media storage.
 *
 * Preview/Acceptance and Production must never share a bucket, a Supabase
 * project or a backup target. Static Wrangler config is checked at deploy time
 * (`scripts/check-cloudflare-production.mjs`); this is the same rule applied at
 * RUNTIME, right before an R2 client is created, so a mis-set secret or variable
 * fails the request instead of writing to the wrong environment.
 *
 * Pure and dependency-free so it can be unit-tested exhaustively.
 */
export type MediaAppEnv = "local" | "staging" | "production";

export const PRODUCTION_SUPABASE_REF = "kkpkgjrweysgvhvkhzun";
export const ACCEPTANCE_SUPABASE_REF = "nxossqhdfltcqdwvbewi";

/** Words that mark a resource as non-Production. Production resources carry none of them. */
const NON_PRODUCTION_MARKERS = ["acceptance", "preview", "staging", "local", "test", "dev"];

export function isNonProductionName(name: string): boolean {
  const parts = name.toLowerCase().split(/[^a-z0-9]+/);
  return NON_PRODUCTION_MARKERS.some((marker) => parts.includes(marker));
}

export function supabaseRefFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(host);
    return match ? match[1]! : null;
  } catch {
    return null;
  }
}

export type MediaEnvironmentInput = {
  appEnv: MediaAppEnv;
  supabaseUrl: string | undefined;
  privateBucket: string | undefined;
  publicBucket?: string | undefined;
  siteBucket?: string | undefined;
};

/** Returns every reason this configuration is unsafe; an empty list means safe to use R2. */
export function mediaEnvironmentProblems(input: MediaEnvironmentInput): string[] {
  const problems: string[] = [];
  const ref = supabaseRefFromUrl(input.supabaseUrl);
  const buckets: Array<[string, string | undefined]> = [
    ["R2_PRIVATE_BUCKET", input.privateBucket],
    ["R2_PUBLIC_BUCKET", input.publicBucket],
    ["R2_SITE_BUCKET", input.siteBucket],
  ];
  for (const [label, name] of buckets) {
    if (!name) continue;
    if (/backup/i.test(name)) problems.push(`${label} must not be a backup bucket`);
    if (input.appEnv === "production" && isNonProductionName(name)) problems.push(`${label} names a non-Production resource in Production`);
    if (input.appEnv === "staging" && !isNonProductionName(name)) problems.push(`${label} looks like a Production bucket outside Production`);
  }
  const named = buckets.filter(([, name]) => name).map(([, name]) => name!);
  if (new Set(named).size !== named.length) problems.push("media buckets must all be different");
  if (input.appEnv === "production") {
    if (ref !== PRODUCTION_SUPABASE_REF) problems.push("Production must use the Production Supabase project");
  } else if (ref === PRODUCTION_SUPABASE_REF) {
    problems.push("only Production may use the Production Supabase project");
  }
  return problems;
}

export function assertMediaEnvironment(input: MediaEnvironmentInput): void {
  const problems = mediaEnvironmentProblems(input);
  // The message is generic on purpose: it can reach logs, never a user, and names no bucket.
  if (problems.length > 0) throw new Error(`media environment refused (${problems.length})`);
}
