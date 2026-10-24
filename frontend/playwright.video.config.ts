import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

/**
 * ISOLATED end-to-end run for R2 media and video (ADR-0020). Everything is local:
 *
 *   * the local Supabase stack (`supabase start`, `supabase db reset`, demo seed);
 *   * an S3-compatible stand-in for R2 at E2E_S3_ENDPOINT (SeaweedFS in a
 *     container; see docs/guides/video-local-e2e.md) with the private bucket;
 *   * the media Worker's real handler on local HTTPS, started by the spec;
 *   * the Python transcode worker, run by the spec with `uv`;
 *   * a production build of the app on port 3200 with R2, edge delivery and
 *     video enabled against those local services.
 *
 * Nothing reaches Cloudflare, R2, Vercel or a hosted Supabase project.
 */
const PORT = 3200;
const EDGE_PORT = Number(process.env.E2E_EDGE_PORT ?? 8788);
const status = Object.fromEntries(
  execFileSync("npx", ["supabase", "status", "-o", "env"], { cwd: "..", encoding: "utf8" })
    .split("\n").map((line) => /^([A-Z_]+)="?(.*?)"?$/.exec(line)).filter((m): m is RegExpExecArray => !!m).map((m) => [m[1], m[2]]),
);
if (!/^http:\/\/127\.0\.0\.1:/.test(status.API_URL ?? "")) throw new Error("The video E2E runs only against a local Supabase stack");
const s3 = process.env.E2E_S3_ENDPOINT ?? "http://127.0.0.1:8333";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(s3)) throw new Error("E2E_S3_ENDPOINT must be local");

// One ticket key per run, shared by the app (signer) and the local edge (verifier).
process.env.E2E_TICKET_SECRET ??= randomBytes(32).toString("base64url");
const shared = {
  E2E_EDGE_PORT: String(EDGE_PORT),
  E2E_S3_ENDPOINT: s3,
  E2E_S3_ACCESS_KEY: process.env.E2E_S3_ACCESS_KEY ?? "localtestaccess",
  E2E_S3_SECRET_KEY: process.env.E2E_S3_SECRET_KEY ?? "localtestsecretkey0123456789",
  E2E_S3_BUCKET: process.env.E2E_S3_BUCKET ?? "aladdin-local-private",
  E2E_DB_URL: status.DB_URL!,
  E2E_API_URL: status.API_URL!,
  E2E_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY!,
  E2E_TICKET_SECRET: process.env.E2E_TICKET_SECRET,
};
Object.assign(process.env, shared);

// Optional: a specific Chromium binary (as in playwright.config.ts).
const launchOptions = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : undefined;

export default defineConfig({
  testDir: "./e2e/video",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 240_000,
  expect: { timeout: 15_000 },
  use: { baseURL: `http://127.0.0.1:${PORT}`, locale: "en-US", ignoreHTTPSErrors: true, trace: "retain-on-failure" },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, launchOptions } },
    { name: "chromium-mobile", use: { ...devices["Pixel 5"], launchOptions } },
  ],
  webServer: {
    command: `pnpm exec next build && pnpm exec next start --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    // E2E_REUSE_SERVER=1 reuses a server already started with the same env (faster reruns).
    reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
    timeout: 900_000, // a production build on a busy machine
    env: {
      ...process.env,
      NEXT_PUBLIC_APP_ENV: "local",
      NEXT_PUBLIC_SUPABASE_URL: status.API_URL!,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY!,
      SUPABASE_URL: status.API_URL!,
      SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY!,
      R2_STORAGE_ENABLED: "true",
      R2_ACCOUNT_ID: "0".repeat(32),
      R2_ACCESS_KEY_ID: shared.E2E_S3_ACCESS_KEY,
      R2_SECRET_ACCESS_KEY: shared.E2E_S3_SECRET_KEY,
      R2_PRIVATE_BUCKET: shared.E2E_S3_BUCKET,
      R2_LOCAL_S3_ENDPOINT: s3,
      MEDIA_EDGE_DELIVERY_ENABLED: "true",
      MEDIA_EDGE_PUBLIC_ENABLED: "true",
      MEDIA_EDGE_ORIGIN: `https://127.0.0.1:${EDGE_PORT}`,
      MEDIA_EDGE_TICKET_KID: "e2e",
      MEDIA_EDGE_TICKET_SECRET: shared.E2E_TICKET_SECRET,
      VIDEO_ENABLED: "true",
    },
  },
});
