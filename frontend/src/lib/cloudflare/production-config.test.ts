import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkBackend,
  checkCutoverStage,
  checkFrontend,
  checkLiveValues,
  jwtProjectRef,
  LIVE_SUPABASE_URL,
  parseJsonc,
} from "../../../scripts/check-cloudflare-production.mjs";

const FRONTEND = join(__dirname, "..", "..", "..");
const frontendConfig = () => parseJsonc(readFileSync(join(FRONTEND, "wrangler.jsonc"), "utf8"));
const backendConfig = () => parseJsonc(readFileSync(join(FRONTEND, "..", "edge", "backend-worker", "wrangler.jsonc"), "utf8"));

// Unsigned JWT-shaped keys: only the payload's `ref` matters to the guard.
const keyFor = (ref: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ ref, role: "anon" })).toString("base64url")}.sig`;
const live = {
  NEXT_PUBLIC_APP_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: LIVE_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: keyFor("kkpkgjrweysgvhvkhzun"),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAFE_live",
};

describe("Cloudflare production config (committed Wrangler files)", () => {
  it("passes for the frontend and backend production environments", () => {
    expect(checkFrontend(frontendConfig())).toEqual([]);
    expect(checkBackend(backendConfig())).toEqual([]);
  });

  it("binds the production backend, so /api/backend never answers 503", () => {
    const services = frontendConfig().env.production.services;
    expect(services).toContainEqual({ binding: "BACKEND", service: "aladdin-backend-production" });
  });

  it("reaches the WhatsApp delivery Worker only through its own environment's private service binding", () => {
    const config = frontendConfig() as unknown as { env: { production: { services: { binding: string; service: string }[] }; preview: { services: { binding: string; service: string }[] } } };
    expect(config.env.production.services).toContainEqual({ binding: "OTP_WORKER", service: "aladdin-whatsapp-otp-production" });
    expect(config.env.preview.services).toContainEqual({ binding: "OTP_WORKER", service: "aladdin-whatsapp-otp-preview" });
    expect(config.env.production.services.filter((s) => s.binding === "OTP_WORKER")).toHaveLength(1);
    expect(config.env.preview.services.filter((s) => s.binding === "OTP_WORKER")).toHaveLength(1);
  });

  it("refuses a frontend with no BACKEND binding", () => {
    const config = frontendConfig();
    config.env.production.services = config.env.production.services.filter((s) => s.binding !== "BACKEND");
    expect(checkFrontend(config)).toContain("frontend production: BACKEND must bind aladdin-backend-production");
  });

  it("requires R2-only media: R2 on, production writes approved and Supabase Storage writes closed", () => {
    const vars = frontendConfig().env.production.vars;
    expect(vars.R2_STORAGE_ENABLED).toBe("true");
    expect(vars.R2_PRODUCTION_WRITES_APPROVED).toBe("true");
    expect(vars.MEDIA_LEGACY_STORAGE_WRITES).toBe("false");
    for (const [flag, bad] of [["R2_STORAGE_ENABLED", "false"], ["R2_PRODUCTION_WRITES_APPROVED", "false"], ["MEDIA_LEGACY_STORAGE_WRITES", "true"]] as const) {
      const config = frontendConfig();
      config.env.production.vars[flag] = bad;
      expect(checkFrontend(config).some((p) => p.includes(flag))).toBe(true);
    }
    const config = frontendConfig();
    delete config.env.production.vars.MEDIA_LEGACY_STORAGE_WRITES;
    expect(checkFrontend(config).some((p) => p.includes("MEDIA_LEGACY_STORAGE_WRITES"))).toBe(true);
  });

  it("refuses an immediate deploy until the owner's cutover approval is recorded", () => {
    expect(checkCutoverStage("frontend", undefined)).toHaveLength(1);
    expect(checkCutoverStage("frontend", "false")).toHaveLength(1);
    expect(checkCutoverStage("frontend", "true")).toEqual([]);
    for (const stage of ["check", "backend", "frontend-upload", undefined]) expect(checkCutoverStage(stage, undefined)).toEqual([]);
  });

  it("refuses a public address, an acceptance resource or Redis switched on", () => {
    const config = frontendConfig();
    config.env.production.workers_dev = true;
    config.env.production.vars.R2_PRIVATE_BUCKET = "aladdin-r2-acceptance-20261011-private";
    config.env.production.vars.REDIS_CACHE_ENABLED = "true";
    const problems = checkFrontend(config);
    expect(problems.some((p) => p.includes("workers_dev"))).toBe(true);
    expect(problems.some((p) => p.includes("acceptance"))).toBe(true);
    expect(problems.some((p) => p.includes("REDIS_CACHE_ENABLED"))).toBe(true);
  });

  it("refuses Turnstile hostnames outside the live domain", () => {
    const config = frontendConfig();
    config.env.production.vars.TURNSTILE_ALLOWED_HOSTNAMES = "aladdindecore.com,www.aladdindecore.com,evil.example";
    expect(checkFrontend(config)).toContain("frontend production: Turnstile hostname outside aladdindecore.com: evil.example");
  });

  it("refuses a backend production pointing at the acceptance project", () => {
    const config = backendConfig();
    config.env.production.vars.SUPABASE_URL = "https://nxossqhdfltcqdwvbewi.supabase.co";
    const problems = checkBackend(config);
    expect(problems.some((p) => p.includes("nxossqhdfltcqdwvbewi"))).toBe(true);
    expect(problems.some((p) => p.includes("SUPABASE_URL is a secret"))).toBe(true);
  });
});

describe("Production build values", () => {
  it("accept the live project only", () => {
    expect(checkLiveValues(live)).toEqual([]);
  });

  it("refuse the acceptance project's URL and anon key", () => {
    const problems = checkLiveValues({
      ...live,
      NEXT_PUBLIC_SUPABASE_URL: "https://nxossqhdfltcqdwvbewi.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: keyFor("nxossqhdfltcqdwvbewi"),
    });
    expect(problems).toContain(`NEXT_PUBLIC_SUPABASE_URL must be exactly ${LIVE_SUPABASE_URL}`);
    expect(problems).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY belongs to another Supabase project");
  });

  it("refuse a secret key, a missing value or a Cloudflare test site key", () => {
    expect(checkLiveValues({ ...live, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_x" })).toHaveLength(1);
    expect(checkLiveValues({ ...live, NEXT_PUBLIC_APP_ENV: "staging" })).toContain("NEXT_PUBLIC_APP_ENV must be production");
    expect(checkLiveValues({ ...live, NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA" }))
      .toContain("NEXT_PUBLIC_TURNSTILE_SITE_KEY is a Cloudflare test key");
    expect(checkLiveValues({ ...live, NEXT_PUBLIC_TURNSTILE_SITE_KEY: undefined })).toContain("NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set");
  });

  it("read the project ref from a legacy anon key and ignore other key formats", () => {
    expect(jwtProjectRef(keyFor("kkpkgjrweysgvhvkhzun"))).toBe("kkpkgjrweysgvhvkhzun");
    expect(jwtProjectRef("sb_publishable_abc")).toBeNull();
  });
});
