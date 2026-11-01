import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseJsonc } from "../../../scripts/check-cloudflare-production.mjs";

const FRONTEND = join(__dirname, "..", "..", "..");
const config = () => parseJsonc(readFileSync(join(FRONTEND, "wrangler.jsonc"), "utf8"));

describe("Admin View-As isolated preview Worker (committed Wrangler config)", () => {
  const env = () => config().env["viewas-preview"];
  const registration = () => config().env.preview;
  const production = () => config().env.production;

  it("is its own Worker, never Registration's preview or production", () => {
    expect(env().name).toBe("aladdin-frontend-viewas-preview");
    expect(env().name).not.toBe(registration().name);
    expect(env().name).not.toBe(production().name);
  });

  it("deploys DARK: no workers.dev route and no preview URLs until the owner enables it behind Access", () => {
    expect(env().workers_dev).toBe(false);
    expect(env().preview_urls).toBe(false);
  });

  it("turns View-As on only here, and never in the Registration preview or production", () => {
    expect(env().vars.ADMIN_VIEW_AS_ENABLED).toBe("true");
    expect(registration().vars.ADMIN_VIEW_AS_ENABLED).toBeUndefined();
    expect(production().vars?.ADMIN_VIEW_AS_ENABLED).toBeUndefined();
  });

  it("serves no hosted media and shares no cache with the other Worker", () => {
    expect(env().vars.R2_STORAGE_ENABLED).toBe("false");
    expect(env().vars.R2_PRODUCTION_WRITES_APPROVED).toBe("false");
    expect(env().vars.REDIS_CACHE_ENABLED).toBe("false");
    expect(env().vars.REDIS_KEY_ENV).toBeUndefined();
    expect(env().vars.REDIS_REST_URL).toBeUndefined();
  });

  it("carries no WhatsApp sender configuration, so mobile sign-up cannot send from this Worker", () => {
    expect(JSON.stringify(env())).not.toMatch(/WHATSAPP/);
  });

  it("points its origin, CAPTCHA hostname and self-binding at itself only", () => {
    const host = "aladdin-frontend-viewas-preview.bstalent9.workers.dev";
    expect(env().vars.APP_PUBLIC_ORIGIN).toBe(`https://${host}`);
    expect(env().vars.TURNSTILE_ALLOWED_HOSTNAMES).toBe(host);
    expect(env().services).toContainEqual({ binding: "WORKER_SELF_REFERENCE", service: env().name });
    // The only shared service is the (stateless) backend preview, never production's.
    expect(env().services.filter((s: { binding: string }) => s.binding === "BACKEND")).toEqual([
      { binding: "BACKEND", service: "aladdin-backend-preview" },
    ]);
  });

  it("never names a production host, project or bucket", () => {
    const text = JSON.stringify(env());
    expect(text).not.toContain("kkpkgjrweysgvhvkhzun");
    expect(text).not.toContain("aladdin-frontend-production");
    expect(text).not.toContain("aladdin-backend-production");
  });
});
