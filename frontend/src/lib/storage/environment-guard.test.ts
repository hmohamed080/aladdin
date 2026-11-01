import { describe, expect, it } from "vitest";
import {
  ACCEPTANCE_SUPABASE_REF, PRODUCTION_SUPABASE_REF, assertMediaEnvironment, isNonProductionName,
  mediaEnvironmentProblems, supabaseRefFromUrl,
} from "./environment-guard";

const prodUrl = `https://${PRODUCTION_SUPABASE_REF}.supabase.co`;
const accUrl = `https://${ACCEPTANCE_SUPABASE_REF}.supabase.co`;

describe("media environment guard", () => {
  it("accepts a correctly separated Production and Acceptance setup", () => {
    expect(mediaEnvironmentProblems({ appEnv: "production", supabaseUrl: prodUrl, privateBucket: "aladdin-media-production-private", siteBucket: "aladdin-media-production-site" })).toEqual([]);
    expect(mediaEnvironmentProblems({ appEnv: "staging", supabaseUrl: accUrl, privateBucket: "aladdin-r2-acceptance-20261011-private" })).toEqual([]);
  });

  it("refuses an Acceptance bucket or Supabase project in Production", () => {
    expect(mediaEnvironmentProblems({ appEnv: "production", supabaseUrl: prodUrl, privateBucket: "aladdin-r2-acceptance-20261011-private" })).toHaveLength(1);
    expect(mediaEnvironmentProblems({ appEnv: "production", supabaseUrl: accUrl, privateBucket: "aladdin-media-production-private" })).toHaveLength(1);
  });

  it("refuses a Production bucket or Supabase project outside Production", () => {
    expect(mediaEnvironmentProblems({ appEnv: "staging", supabaseUrl: accUrl, privateBucket: "aladdin-media-production-private" })).toHaveLength(1);
    expect(mediaEnvironmentProblems({ appEnv: "staging", supabaseUrl: prodUrl, privateBucket: "aladdin-r2-acceptance-private" })).toHaveLength(1);
    expect(mediaEnvironmentProblems({ appEnv: "local", supabaseUrl: prodUrl, privateBucket: "aladdin-local-private" })).toHaveLength(1);
  });

  it("refuses a missing or foreign Supabase URL in Production", () => {
    expect(mediaEnvironmentProblems({ appEnv: "production", supabaseUrl: undefined, privateBucket: "aladdin-media-production-private" })).toHaveLength(1);
    expect(mediaEnvironmentProblems({ appEnv: "production", supabaseUrl: "https://evil.example", privateBucket: "aladdin-media-production-private" })).toHaveLength(1);
  });

  it("never lets a backup bucket or a shared bucket serve media", () => {
    expect(mediaEnvironmentProblems({ appEnv: "production", supabaseUrl: prodUrl, privateBucket: "aladdin-production-db-backups" }).join()).toContain("backup");
    expect(mediaEnvironmentProblems({ appEnv: "production", supabaseUrl: prodUrl, privateBucket: "aladdin-media-production-private", siteBucket: "aladdin-media-production-private" }).join()).toContain("different");
  });

  it("throws a generic error that names no bucket", () => {
    expect(() => assertMediaEnvironment({ appEnv: "production", supabaseUrl: prodUrl, privateBucket: "aladdin-acceptance-secret-name" })).toThrow(/^media environment refused \(1\)$/);
  });

  it("recognises markers only as whole words", () => {
    expect(isNonProductionName("aladdin-r2-acceptance-20261011-private")).toBe(true);
    expect(isNonProductionName("aladdin-media-production-private")).toBe(false);
    expect(isNonProductionName("aladdin-contest-private")).toBe(false);
  });

  it("reads the project ref only from a real Supabase host", () => {
    expect(supabaseRefFromUrl(prodUrl)).toBe(PRODUCTION_SUPABASE_REF);
    expect(supabaseRefFromUrl("https://nxossqhdfltcqdwvbewi.supabase.co.evil.example")).toBeNull();
    expect(supabaseRefFromUrl("not a url")).toBeNull();
  });
});
