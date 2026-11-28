import { describe, expect, it } from "vitest";
import { ENVIRONMENT_MANIFEST, type EnvironmentIdentity } from "./environment-manifest";
import {
  ACCEPTANCE_SUPABASE_REF, PRODUCTION_SUPABASE_REF, assertMediaEnvironment, isNonProductionName,
  mediaEnvironmentProblems, supabaseRefFromUrl,
} from "./environment-guard";

const ACCOUNT = "a".repeat(32);
const OTHER_ACCOUNT = "b".repeat(32);
const prodUrl = `https://${PRODUCTION_SUPABASE_REF}.supabase.co`;
const accUrl = `https://${ACCEPTANCE_SUPABASE_REF}.supabase.co`;
const ACC_BUCKET = ENVIRONMENT_MANIFEST.staging.buckets.private!;
const PINNED_ACCOUNT = ENVIRONMENT_MANIFEST.production.r2AccountId!;
// The state before the owner approved Production resources: nothing pinned, so everything must fail closed.
const unapproved: Record<"production" | "staging", EnvironmentIdentity> = {
  production: { ...ENVIRONMENT_MANIFEST.production, r2AccountId: null, buckets: { private: null, public: null, site: null } },
  staging: ENVIRONMENT_MANIFEST.staging,
};

// A Production identity as it will look once the owner approves the resources.
const approved: Record<"production" | "staging", EnvironmentIdentity> = {
  production: { ...ENVIRONMENT_MANIFEST.production, r2AccountId: ACCOUNT, buckets: { private: "aladdin-prod-media-1", public: null, site: "aladdin-prod-site-1" } },
  staging: ENVIRONMENT_MANIFEST.staging,
};
const prod = (extra = {}) => ({ appEnv: "production" as const, supabaseUrl: prodUrl, accountId: ACCOUNT, privateBucket: "aladdin-prod-media-1", ...extra });

describe("exact environment identity", () => {
  it("accepts exactly the approved Production and Acceptance resources", () => {
    expect(mediaEnvironmentProblems(prod({ siteBucket: "aladdin-prod-site-1" }), approved)).toEqual([]);
    expect(mediaEnvironmentProblems({ appEnv: "staging", supabaseUrl: accUrl, privateBucket: ACC_BUCKET, accountId: PINNED_ACCOUNT })).toEqual([]);
  });

  it("accepts the committed Production names with the pinned account and nothing else", () => {
    const real = { appEnv: "production" as const, supabaseUrl: prodUrl, accountId: PINNED_ACCOUNT, privateBucket: "aladdin-media-private", siteBucket: "aladdin-site-media" };
    expect(mediaEnvironmentProblems(real)).toEqual([]);
    expect(mediaEnvironmentProblems({ ...real, privateBucket: "aladdin-media-private-2" })).not.toEqual([]);
    expect(mediaEnvironmentProblems({ ...real, siteBucket: "aladdin-site-media-2" })).not.toEqual([]);
    expect(mediaEnvironmentProblems({ ...real, accountId: OTHER_ACCOUNT })).not.toEqual([]);
    expect(mediaEnvironmentProblems({ ...real, supabaseUrl: accUrl })).not.toEqual([]);
    expect(mediaEnvironmentProblems({ ...real, privateBucket: "aladdin-production-db-backups" })).not.toEqual([]);
  });

  it("refuses a misleading name in Acceptance: containing 'acceptance' is not enough", () => {
    for (const name of ["evil-acceptance-copy", "aladdin-r2-acceptance-20261011-private-2", "acceptance"]) {
      expect(mediaEnvironmentProblems({ appEnv: "staging", supabaseUrl: accUrl, privateBucket: name }), name).not.toEqual([]);
    }
  });

  it("refuses an arbitrary non-staging bucket in Production, even a plausible one", () => {
    for (const name of ["aladdin-prod-media-2", "aladdin-media-production-private", "aladdin-prod-media-1 "]) {
      expect(mediaEnvironmentProblems(prod({ privateBucket: name }), approved), name).not.toEqual([]);
    }
  });

  it("fails closed in Production until a bucket and the account are approved", () => {
    expect(mediaEnvironmentProblems(prod(), unapproved)).not.toEqual([]);
    expect(mediaEnvironmentProblems(prod({ privateBucket: "anything" }), unapproved)).toEqual(
      expect.arrayContaining([expect.stringContaining("no approved bucket"), expect.stringContaining("not pinned")]));
  });

  it("refuses mismatched bindings: wrong Supabase project or Cloudflare account", () => {
    expect(mediaEnvironmentProblems(prod({ supabaseUrl: accUrl }), approved)).not.toEqual([]);
    expect(mediaEnvironmentProblems(prod({ accountId: OTHER_ACCOUNT }), approved)).not.toEqual([]);
    expect(mediaEnvironmentProblems(prod({ accountId: undefined }), approved)).not.toEqual([]);
    expect(mediaEnvironmentProblems({ appEnv: "staging", supabaseUrl: prodUrl, privateBucket: ACC_BUCKET })).not.toEqual([]);
  });

  it("pins the Acceptance account when the owner supplies it", () => {
    const pinned = { ...approved, staging: { ...approved.staging, r2AccountId: ACCOUNT } };
    expect(mediaEnvironmentProblems({ appEnv: "staging", supabaseUrl: accUrl, privateBucket: ACC_BUCKET, accountId: ACCOUNT }, pinned)).toEqual([]);
    expect(mediaEnvironmentProblems({ appEnv: "staging", supabaseUrl: accUrl, privateBucket: ACC_BUCKET, accountId: OTHER_ACCOUNT }, pinned)).not.toEqual([]);
  });

  it("never lets a backup bucket or a shared bucket serve media", () => {
    expect(mediaEnvironmentProblems(prod({ privateBucket: "aladdin-production-db-backups" }), approved).join()).toContain("backup");
    expect(mediaEnvironmentProblems(prod({ siteBucket: "aladdin-prod-media-1" }), approved).join()).toContain("different");
    expect(mediaEnvironmentProblems({ appEnv: "staging", supabaseUrl: accUrl, privateBucket: "aladdin-acceptance-backups-weur" }).join()).toContain("backup");
  });

  it("keeps site media in its own approved bucket", () => {
    expect(mediaEnvironmentProblems(prod({ siteBucket: "aladdin-prod-media-1x" }), approved)).not.toEqual([]);
    expect(mediaEnvironmentProblems({ appEnv: "staging", supabaseUrl: accUrl, privateBucket: ACC_BUCKET, siteBucket: "aladdin-r2-acceptance-site" })).not.toEqual([]);
  });

  it("lets local runs use test buckets but never a hosted project", () => {
    expect(mediaEnvironmentProblems({ appEnv: "local", supabaseUrl: "http://127.0.0.1:54321", privateBucket: "aladdin-local-private" })).toEqual([]);
    expect(mediaEnvironmentProblems({ appEnv: "local", supabaseUrl: prodUrl, privateBucket: "aladdin-local-private" })).not.toEqual([]);
    expect(mediaEnvironmentProblems({ appEnv: "local", supabaseUrl: accUrl, privateBucket: "aladdin-local-private" })).not.toEqual([]);
  });

  it("throws a generic error that names no bucket", () => {
    expect(() => assertMediaEnvironment({ appEnv: "production", supabaseUrl: prodUrl, privateBucket: "aladdin-acceptance-secret-name" })).toThrow(/^media environment refused \(\d+\)$/);
  });

  it("recognises markers only as whole words, and reads the ref only from a real Supabase host", () => {
    expect(isNonProductionName("aladdin-r2-acceptance-20261011-private")).toBe(true);
    expect(isNonProductionName("aladdin-contest-private")).toBe(false);
    expect(supabaseRefFromUrl(prodUrl)).toBe(PRODUCTION_SUPABASE_REF);
    expect(supabaseRefFromUrl("https://nxossqhdfltcqdwvbewi.supabase.co.evil.example")).toBeNull();
  });
});
