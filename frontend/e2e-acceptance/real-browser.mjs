// Starts the owner's REAL Google Chrome or Microsoft Edge (not a Playwright-launched one) with a remote-debugging port and a brand-new,
// separate profile, so the suite can attach to it with connectOverCDP. Playwright's own launcher adds automation switches
// (--enable-automation and others) that Turnstile flags as an embedded browser; a normally started browser does not have them.
//
// This does NOT hide, patch or spoof anything: no flag removed from Playwright, no navigator override, no init script. The browser is
// simply started the way a person starts it, and the existing Turnstile widget is completed by the person in that window.
//
// The debugging port is bound to 127.0.0.1 only, picked at random, and lives only for the run. The profile is a fresh temp folder
// (no saved logins, extensions or cookies of the owner) and is deleted afterwards.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const env = (k) => process.env[k] ?? "";
const WINDOWS_PATHS = {
  chrome: () => [
    join(env("ProgramFiles"), "Google/Chrome/Application/chrome.exe"),
    join(env("ProgramFiles(x86)"), "Google/Chrome/Application/chrome.exe"),
    join(env("LocalAppData"), "Google/Chrome/Application/chrome.exe"),
  ],
  edge: () => [
    join(env("ProgramFiles(x86)"), "Microsoft/Edge/Application/msedge.exe"),
    join(env("ProgramFiles"), "Microsoft/Edge/Application/msedge.exe"),
  ],
};
const OTHER_PATHS = {
  chrome: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"],
  edge: ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"],
};

/** Path of the installed browser, or null. `kind` is "chrome" or "edge". */
export function findBrowser(kind) {
  const candidates = process.platform === "win32" ? (WINDOWS_PATHS[kind]?.() ?? []) : (OTHER_PATHS[kind] ?? []);
  return candidates.find((p) => p && existsSync(p)) ?? null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function waitForDebugger(port, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("The browser did not open its debugging port in time.");
}

/**
 * Starts the browser. `extraArgs` is for tests only (for example headless, no-sandbox); a normal run passes none.
 * Returns { cdpUrl, args, stop() }.
 */
export async function startRealBrowser(executable, { extraArgs = [] } = {}) {
  const port = await freePort();
  const profile = mkdtempSync(join(tmpdir(), "aladdin-e2e-profile-"));
  const args = [
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    ...extraArgs,
    "about:blank",
  ];
  const child = spawn(executable, args, { stdio: "ignore", detached: false });
  child.on("error", () => {});
  const stop = () => {
    try {
      if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    setTimeout(() => {
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        /* the OS may still hold files for a moment; the temp folder is disposable */
      }
    }, 1500).unref();
  };
  try {
    await waitForDebugger(port, 30_000);
  } catch (e) {
    stop();
    throw e;
  }
  return { cdpUrl: `http://127.0.0.1:${port}`, args, stop };
}
