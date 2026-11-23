import { ENVIRONMENT_MANIFEST, type EnvironmentIdentity } from "./environment-manifest";

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

export const PRODUCTION_SUPABASE_REF = ENVIRONMENT_MANIFEST.production.supabaseRef;
export const ACCEPTANCE_SUPABASE_REF = ENVIRONMENT_MANIFEST.staging.supabaseRef;

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
  accountId?: string | undefined;
  appEnv: MediaAppEnv | undefined;
  supabaseUrl: string | undefined;
  privateBucket: string | undefined;
  publicBucket?: string | undefined;
  siteBucket?: string | undefined;
};

/**
 * Returns every reason this configuration is unsafe; an empty list means safe to use R2.
 * Exact identity first (project ref, account, bucket names from the manifest), markers second.
 */
export function mediaEnvironmentProblems(input: MediaEnvironmentInput,
  manifest: Record<"production" | "staging", EnvironmentIdentity> = ENVIRONMENT_MANIFEST): string[] {
  const problems: string[] = [];
  const ref = supabaseRefFromUrl(input.supabaseUrl);
  const slots: Array<["private" | "public" | "site", string, string | undefined]> = [
    ["private", "R2_PRIVATE_BUCKET", input.privateBucket],
    ["public", "R2_PUBLIC_BUCKET", input.publicBucket],
    ["site", "R2_SITE_BUCKET", input.siteBucket],
  ];
  const appEnv = input.appEnv ?? "local";
  const identity = appEnv === "local" ? null : manifest[appEnv];
  for (const [slot, label, name] of slots) {
    if (!name) continue;
    if (/backup/i.test(name)) problems.push(`${label} must not be a backup bucket`);
    if (appEnv === "production" && isNonProductionName(name)) problems.push(`${label} names a non-Production resource in Production`);
    if (appEnv === "staging" && !isNonProductionName(name)) problems.push(`${label} looks like a Production bucket outside Production`);
    if (identity) {
      const approved = identity.buckets[slot];
      if (approved === null) problems.push(`${label} has no approved bucket for this environment yet`);
      else if (name !== approved) problems.push(`${label} is not the approved bucket for this environment`);
      if (identity.backupBuckets.includes(name)) problems.push(`${label} is a backup target`);
    }
  }
  const named = slots.filter(([, , name]) => name).map(([, , name]) => name!);
  if (new Set(named).size !== named.length) problems.push("media buckets must all be different");

  if (identity) {
    if (ref !== identity.supabaseRef) problems.push("the Supabase project is not the approved one for this environment");
    if (identity.r2AccountId === null) {
      // Production must pin its account; Acceptance may run unpinned until the owner supplies it.
      if (appEnv === "production") problems.push("the Cloudflare account is not pinned for Production");
    } else if (input.accountId !== identity.r2AccountId) {
      problems.push("the Cloudflare account is not the approved one for this environment");
    }
    // The other environment's account/projects are never acceptable.
    const other = appEnv === "production" ? manifest.staging : manifest.production;
    if (ref === other.supabaseRef) problems.push("another environment's Supabase project");
    if (other.r2AccountId && input.accountId === other.r2AccountId && identity.r2AccountId !== other.r2AccountId) problems.push("another environment's Cloudflare account");
  } else if (ref === manifest.production.supabaseRef || ref === manifest.staging.supabaseRef) {
    problems.push("local runs must not use a hosted Supabase project");
  }
  return problems;
}

export function assertMediaEnvironment(input: MediaEnvironmentInput): void {
  const problems = mediaEnvironmentProblems(input);
  // The message is generic on purpose: it can reach logs, never a user, and names no bucket.
  if (problems.length > 0) throw new Error(`media environment refused (${problems.length})`);
}
