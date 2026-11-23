import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const env = vi.hoisted(() => ({
  storage: {} as Record<string, unknown>, supabase: "" as string,
}));
vi.mock("@/lib/env/storage", () => ({ readStorageEnv: () => env.storage }));
vi.mock("@/lib/env", () => ({ readPublicEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: env.supabase }) }));
import { CloudflareR2StorageProvider, createR2Client } from "./r2-provider";
import { ACCEPTANCE_SUPABASE_REF, PRODUCTION_SUPABASE_REF } from "@/lib/storage/environment-guard";
import { ENVIRONMENT_MANIFEST } from "@/lib/storage/environment-manifest";

const base = { R2_ACCOUNT_ID: ENVIRONMENT_MANIFEST.production.r2AccountId!, R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s" };
const set = (appEnv: string, bucket: string, ref: string, extra: Record<string, unknown> = {}) => {
  env.storage = { ...base, APP_ENV: appEnv, R2_PRIVATE_BUCKET: bucket, ...extra };
  env.supabase = `https://${ref}.supabase.co`;
};
beforeEach(() => set("staging", "aladdin-r2-acceptance-20261011-private", ACCEPTANCE_SUPABASE_REF));

describe("R2 client refuses the wrong environment", () => {
  it("works for the approved Acceptance setup", () => {
    expect(() => new CloudflareR2StorageProvider("avatar")).not.toThrow();
  });
  it("works for the approved Production setup and refuses an unpinned account", () => {
    set("production", "aladdin-media-private", PRODUCTION_SUPABASE_REF, { R2_SITE_BUCKET: "aladdin-site-media" });
    expect(() => createR2Client()).not.toThrow();
    set("production", "aladdin-media-private", PRODUCTION_SUPABASE_REF, { R2_ACCOUNT_ID: "b".repeat(32) });
    expect(() => createR2Client()).toThrow("media environment refused");
  });
  it("refuses a look-alike Acceptance bucket and any unapproved Production bucket", () => {
    set("staging", "evil-acceptance-copy", ACCEPTANCE_SUPABASE_REF);
    expect(() => new CloudflareR2StorageProvider("avatar")).toThrow("media environment refused");
    set("production", "aladdin-media-production-private", PRODUCTION_SUPABASE_REF);
    expect(() => new CloudflareR2StorageProvider("avatar")).toThrow("media environment refused");
  });
  it("refuses an Acceptance bucket from Production, and a Production bucket from Acceptance", () => {
    set("production", "aladdin-r2-acceptance-20261011-private", PRODUCTION_SUPABASE_REF);
    expect(() => new CloudflareR2StorageProvider("avatar")).toThrow("media environment refused");
    set("staging", "aladdin-media-production-private", ACCEPTANCE_SUPABASE_REF);
    expect(() => new CloudflareR2StorageProvider("avatar")).toThrow("media environment refused");
  });
  it("refuses Production against the Acceptance database, and Acceptance against Production's", () => {
    set("production", "aladdin-media-production-private", ACCEPTANCE_SUPABASE_REF);
    expect(() => createR2Client()).toThrow("media environment refused");
    set("staging", "aladdin-r2-acceptance-20261011-private", PRODUCTION_SUPABASE_REF);
    expect(() => createR2Client()).toThrow("media environment refused");
  });
  it("refuses a backup bucket as the media bucket", () => {
    set("production", "aladdin-production-db-backups", PRODUCTION_SUPABASE_REF);
    expect(() => createR2Client()).toThrow("media environment refused");
  });
  it("refuses a site bucket shared with the user-media bucket", () => {
    set("staging", "aladdin-r2-acceptance-private", ACCEPTANCE_SUPABASE_REF, { R2_SITE_BUCKET: "aladdin-r2-acceptance-private" });
    expect(() => createR2Client()).toThrow("media environment refused");
  });
});
