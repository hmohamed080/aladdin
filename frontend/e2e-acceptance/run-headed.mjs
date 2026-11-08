// Manual, headed Hosted Acceptance E2E (owner's PC). Your real Chrome or Edge (see real-browser.mjs); a person completes a genuine Turnstile challenge in the
// browser window if Cloudflare shows one. NOTHING about Turnstile or Cloudflare Access is stubbed, bypassed or changed, and no hosted
// workflow, deployment or database is touched.
//
// Secrets: asked for here with hidden input, held in memory, handed only to the child test process through its environment, and never
// printed or written to disk. GitHub Secrets are not available locally, so there is no fallback to them or to files.
//
//   Run from the repo root:   pnpm --filter frontend e2e:acceptance:headed
//
// Safety kept from the hosted suite: Acceptance preview only (the config refuses any other ACCEPTANCE_BASE_URL and requests to the
// live Supabase project or aladdindecore.com abort the run), exact-origin Access token scoping, read-only, trace/video/screenshot
// off, scrubbed errors. The JSON report goes to a fresh temp folder, never into the repository.

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { ACCEPTANCE_PREVIEW_ORIGIN, ID_ENV, SECRET_ENV, preflight } from "./access.mjs";
import { findBrowser, startRealBrowser } from "./real-browser.mjs";

// Which browser runs the suite:  chrome (default) | edge  = your REAL installed browser, started normally with a debugging port and a
// fresh separate profile, then attached to (Turnstile flags the Playwright-launched browser as embedded).  playwright = the old mode.
//   pnpm --filter frontend e2e:acceptance:headed            -> Chrome
//   pnpm --filter frontend e2e:acceptance:headed edge       -> Microsoft Edge
const MODE = (process.argv[2] ?? "chrome").toLowerCase();
if (!["chrome", "edge", "playwright"].includes(MODE)) {
  console.error('Usage: e2e:acceptance:headed [chrome|edge|playwright]   (default chrome)');
  process.exit(1);
}

const PROMPTS = [
  [ID_ENV, "Cloudflare Access service-token Client ID"],
  [SECRET_ENV, "Cloudflare Access service-token Client Secret"],
  ["ACCEPTANCE_E2E_OWNER_PASSWORD", "Owner (test1@example.com) password"],
  ["ACCEPTANCE_E2E_MANAGER_PASSWORD", "Sales Manager (acc6-sales-manager@example.test) password"],
  ["ACCEPTANCE_E2E_REP_PASSWORD", "Sales Rep (acc6-sales-rep@example.test) password"],
];

/** Reads one line with the typed characters hidden. Refuses a non-interactive terminal (nothing is ever read from a pipe or file). */
function askHidden(label) {
  return new Promise((resolve, reject) => {
    let muted = false;
    const out = new Writable({
      write(chunk, _enc, cb) {
        if (!muted) process.stdout.write(chunk);
        cb();
      },
    });
    const rl = createInterface({ input: process.stdin, output: out, terminal: true });
    rl.question(`${label}: `, (answer) => {
      muted = false;
      process.stdout.write("\n");
      rl.close();
      if (answer.trim()) resolve(answer.trim());
      else reject(new Error(`${label} was empty.`));
    });
    muted = true; // the prompt text was already written by question(); mute everything typed after it
  });
}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Run this in an interactive terminal: the credentials are typed with hidden input and never read from a pipe or file.");
  }
  const secrets = {};
  console.log("Enter the five values. Nothing is displayed or stored.\n");
  for (const [name, label] of PROMPTS) secrets[name] = await askHidden(label);

  const childEnv = {
    ...process.env,
    ...secrets,
    ACCEPTANCE_BASE_URL: ACCEPTANCE_PREVIEW_ORIGIN,
    ACCEPTANCE_E2E_HEADED: "1",
    ACCEPTANCE_E2E_REPORT_FILE: join(mkdtempSync(join(tmpdir(), "aladdin-acceptance-e2e-")), "results.json"),
  };

  // 1) Access preflight, no browser: proves the service token reaches the Acceptance backend before anything else runs.
  const problems = await preflight(childEnv);
  if (problems.length) throw new Error(`Preflight failed:\n- ${problems.join("\n- ")}`);
  console.log("Preflight OK: the Acceptance preview answered through Cloudflare Access (backend ok, env staging).");
  console.log("Your browser opens next. If Cloudflare shows a verification, complete it by hand. Do not close the window.\n");

  // 2) Your real browser (never hidden or modified), then the same suite as the hosted workflow attached to it.
  let real = null;
  if (MODE !== "playwright") {
    const exe = findBrowser(MODE);
    if (!exe) throw new Error(`${MODE === "edge" ? "Microsoft Edge" : "Google Chrome"} was not found in its standard install location. Try the other one (chrome | edge).`);
    real = await startRealBrowser(exe);
    childEnv.ACCEPTANCE_E2E_CDP_URL = real.cdpUrl;
    console.log(`Started your ${MODE === "edge" ? "Microsoft Edge" : "Google Chrome"} with a fresh temporary profile (no saved logins). Debugging port is local-only.`);
  }
  const closeReal = () => real?.stop();
  process.on("SIGINT", () => {
    closeReal();
    process.exit(130);
  });
  const frontend = fileURLToPath(new URL("..", import.meta.url));
  const code = await new Promise((resolve) => {
    const child = spawn("pnpm", ["exec", "playwright", "test", "-c", "playwright.acceptance.config.ts"], {
      cwd: frontend,
      env: childEnv,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("exit", (c) => resolve(c ?? 1));
    child.on("error", () => resolve(1));
  });
  closeReal();
  console.log(`\nJSON report (test names and scrubbed messages only): ${childEnv.ACCEPTANCE_E2E_REPORT_FILE}`);
  process.exit(code);
}

main().catch((e) => {
  console.error(`\n${String(e.message ?? e).split("\n").slice(0, 6).join("\n")}`);
  process.exit(1);
});
