/**
 * The approved storage identity of each environment, pinned in code.
 *
 * Name markers ("acceptance", "production") are only defense in depth: an environment may use
 * exactly the resources listed here and nothing else, so a bucket called `evil-acceptance-copy`
 * is refused in Acceptance and an arbitrary non-staging bucket is refused in Production.
 *
 * `null` means "not yet approved": any use of that resource FAILS CLOSED. Production values are
 * filled in only when the owner creates the resource and approves its name (a reviewed commit, not a
 * variable that a mis-set secret could change).
 */
export type EnvironmentIdentity = {
  /** Supabase project ref (the only database/Auth this environment may talk to). */
  supabaseRef: string;
  /** Cloudflare account id that owns the R2 buckets; null = not pinned yet. */
  r2AccountId: string | null;
  /** Exact bucket names; null = not approved yet. */
  buckets: { private: string | null; public: string | null; site: string | null };
  /** The backup targets of this environment: never valid as a media bucket. */
  backupBuckets: readonly string[];
};

export const ENVIRONMENT_MANIFEST: Record<"production" | "staging", EnvironmentIdentity> = {
  production: {
    supabaseRef: "kkpkgjrweysgvhvkhzun",
    // Owner-confirmed 2026-11-08. Bucket names stay null until the buckets exist (they are pinned in the commit that follows creation).
    r2AccountId: "a4c2b7ac45e58a81691b9165492ce6a2",
    buckets: { private: null, public: null, site: null },
    backupBuckets: ["aladdin-production-db-backups"],
  },
  staging: {
    supabaseRef: "nxossqhdfltcqdwvbewi",
    r2AccountId: "a4c2b7ac45e58a81691b9165492ce6a2",
    buckets: { private: "aladdin-r2-acceptance-20261011-private", public: "aladdin-r2-acceptance-20261011-public", site: "aladdin-acceptance-site-media" },
    backupBuckets: ["aladdin-acceptance-backups-weur"],
  },
};
