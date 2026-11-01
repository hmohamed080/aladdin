import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseJsonc } from "../../../scripts/check-cloudflare-production.mjs";
import { ENVIRONMENT_MANIFEST } from "./environment-manifest";

const wrangler = parseJsonc(readFileSync(join(__dirname, "..", "..", "..", "wrangler.jsonc"), "utf8")) as { env: Record<"preview" | "production", { vars: Record<string, string> }> };

describe("committed Wrangler config agrees with the environment manifest", () => {
  it("binds the Preview Worker to exactly the approved Acceptance bucket", () => {
    expect(wrangler.env.preview.vars.R2_PRIVATE_BUCKET).toBe(ENVIRONMENT_MANIFEST.staging.buckets.private);
  });
  it("names no media bucket for Production until one is approved", () => {
    const vars = wrangler.env.production.vars;
    expect(vars.R2_PRIVATE_BUCKET ?? null).toBe(ENVIRONMENT_MANIFEST.production.buckets.private);
    expect(vars.R2_SITE_BUCKET ?? null).toBe(ENVIRONMENT_MANIFEST.production.buckets.site);
  });
  it("keeps every environment's bucket, backup and project identities disjoint", () => {
    const names = [ENVIRONMENT_MANIFEST.production, ENVIRONMENT_MANIFEST.staging]
      .flatMap((e) => [...Object.values(e.buckets), ...e.backupBuckets]).filter((n): n is string => n !== null);
    expect(new Set(names).size).toBe(names.length);
    expect(ENVIRONMENT_MANIFEST.production.supabaseRef).not.toBe(ENVIRONMENT_MANIFEST.staging.supabaseRef);
  });
});
