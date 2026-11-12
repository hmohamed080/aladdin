#!/usr/bin/env node
/**
 * Guards for the Cloudflare `production` environments (frontend and backend Workers).
 *
 * Run by the manual `Cloudflare production` workflow before anything is built or
 * uploaded, and by the frontend tests on every change. It checks two things:
 *   1. the committed Wrangler config: production Workers have no public address yet,
 *      the frontend reaches the backend through the BACKEND binding, Turnstile is
 *      pinned to the live hostnames, R2-only media flags are on and Redis stays off,
 *      the required secrets are declared, and nothing points at an acceptance resource;
 *   2. with `--live-values`, the build-time values in the environment: the live Supabase
 *      project only, never the acceptance project or a secret key.
 *
 * Exit code 1 with one line per problem. Values are never printed.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LIVE_SUPABASE_URL = "https://kkpkgjrweysgvhvkhzun.supabase.co";
export const LIVE_HOSTNAMES = ["aladdindecore.com", "www.aladdindecore.com"];
/** Production media flags in the committed config: R2 takes every new upload, Supabase Storage takes none. */
export const R2_ONLY_FLAGS = { R2_STORAGE_ENABLED: "true", R2_PRODUCTION_WRITES_APPROVED: "true", MEDIA_LEGACY_STORAGE_WRITES: "false" };
const ACCEPTANCE_MARKERS = ["nxossqhdfltcqdwvbewi", "acceptance", "cf-preview", "-preview", "workers.dev"];

/** Strips `//` and `/* *\/` comments outside strings, then trailing commas. */
export function parseJsonc(text) {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
    } else if (ch === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
    } else {
      out += ch;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

function noPublicAddress(env, label, problems) {
  if (env.workers_dev !== false) problems.push(`${label}: workers_dev must be false until a test hostname is approved`);
  if (env.preview_urls) problems.push(`${label}: preview_urls must be off`);
  if (env.route || env.routes) problems.push(`${label}: routes are added at cutover, not in this file`);
}

function noAcceptance(env, label, problems) {
  const text = JSON.stringify(env).toLowerCase();
  for (const marker of ACCEPTANCE_MARKERS) {
    // The Worker's own name may not contain a marker either.
    if (text.includes(marker)) problems.push(`${label}: refers to an acceptance or preview resource (${marker})`);
  }
}

function requiredSecrets(env, names, label, problems) {
  const declared = env.secrets?.required ?? [];
  for (const name of names) if (!declared.includes(name)) problems.push(`${label}: secrets.required must list ${name}`);
}

export function checkFrontend(config) {
  const problems = [];
  const env = config.env?.production;
  if (!env) return ["frontend: env.production is missing"];
  const label = "frontend production";
  if (env.name !== "aladdin-frontend-production") problems.push(`${label}: name must be aladdin-frontend-production`);
  noPublicAddress(env, label, problems);
  noAcceptance(env, label, problems);
  const backend = (env.services ?? []).find((service) => service.binding === "BACKEND");
  if (backend?.service !== "aladdin-backend-production") problems.push(`${label}: BACKEND must bind aladdin-backend-production`);
  const vars = env.vars ?? {};
  if (vars.NEXT_PUBLIC_APP_ENV !== "production") problems.push(`${label}: NEXT_PUBLIC_APP_ENV must be production`);
  const hosts = String(vars.TURNSTILE_ALLOWED_HOSTNAMES ?? "").split(",").map((host) => host.trim()).filter(Boolean);
  if (hosts.length === 0) problems.push(`${label}: TURNSTILE_ALLOWED_HOSTNAMES must pin the live hostnames`);
  for (const host of LIVE_HOSTNAMES) if (hosts.length && !hosts.includes(host)) problems.push(`${label}: TURNSTILE_ALLOWED_HOSTNAMES must include ${host}`);
  for (const host of hosts) if (host !== "aladdindecore.com" && !host.endsWith(".aladdindecore.com")) problems.push(`${label}: Turnstile hostname outside aladdindecore.com: ${host}`);
  // R2-only media: new uploads go to R2 and Supabase Storage writes stay closed. A committed config that reopens them
  // (flags off, or legacy writes on) would let a routine redeploy silently resume Supabase writes, so it is refused.
  for (const [flag, want] of Object.entries(R2_ONLY_FLAGS)) {
    if (vars[flag] !== want) problems.push(`${label}: ${flag} must be "${want}" (R2-only media; Supabase Storage writes stay closed)`);
  }
  for (const flag of ["REDIS_CACHE_ENABLED", "VIDEO_ENABLED", "MEDIA_EDGE_DELIVERY_ENABLED"]) {
    if (flag in vars && vars[flag] !== "false") problems.push(`${label}: ${flag} must stay "false" until its own approval`);
  }
  if (!("REDIS_CACHE_ENABLED" in vars)) problems.push(`${label}: REDIS_CACHE_ENABLED must be set to "false" explicitly`);
  requiredSecrets(env, ["SUPABASE_SERVICE_ROLE_KEY", "TURNSTILE_SECRET_KEY", "AUTH_PASSWORD_PREVIEW_GRANT_SECRET"], label, problems);
  return problems;
}

export function checkBackend(config) {
  const problems = [];
  const env = config.env?.production;
  if (!env) return ["backend: env.production is missing"];
  const label = "backend production";
  if (env.name !== "aladdin-backend-production") problems.push(`${label}: name must be aladdin-backend-production`);
  noPublicAddress(env, label, problems);
  noAcceptance(env, label, problems);
  if (env.vars?.APP_ENV !== "production") problems.push(`${label}: APP_ENV must be production`);
  if (env.vars?.SUPABASE_URL) problems.push(`${label}: SUPABASE_URL is a secret set at deploy, not a var`);
  requiredSecrets(env, ["SUPABASE_URL", "SUPABASE_ANON_KEY"], label, problems);
  return problems;
}

/** The Supabase project ref a legacy JWT anon key was issued for, or null. */
export function jwtProjectRef(key) {
  const payload = key.split(".")[1];
  if (!key.startsWith("eyJ") || !payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).ref ?? null;
  } catch {
    return null;
  }
}

export function checkLiveValues(values) {
  const problems = [];
  if (values.NEXT_PUBLIC_APP_ENV !== "production") problems.push("NEXT_PUBLIC_APP_ENV must be production");
  if (values.NEXT_PUBLIC_SUPABASE_URL !== LIVE_SUPABASE_URL) problems.push(`NEXT_PUBLIC_SUPABASE_URL must be exactly ${LIVE_SUPABASE_URL}`);
  const key = values.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!key) problems.push("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set");
  else if (key.startsWith("sb_secret_")) problems.push("NEXT_PUBLIC_SUPABASE_ANON_KEY is a secret key; use the anon/publishable key");
  else {
    const ref = jwtProjectRef(key);
    if (ref !== null && ref !== "kkpkgjrweysgvhvkhzun") problems.push("NEXT_PUBLIC_SUPABASE_ANON_KEY belongs to another Supabase project");
  }
  const site = values.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  if (!site) problems.push("NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set");
  // Cloudflare's published test site keys start with 1x, 2x or 3x.
  else if (/^[123]x0{8}/.test(site)) problems.push("NEXT_PUBLIC_TURNSTILE_SITE_KEY is a Cloudflare test key");
  return problems;
}

/**
 * The committed config turns R2-only writes on, so a stage that deploys at once (`frontend`) would activate them
 * on live Production. It is refused until the owner sets R2_CUTOVER_APPROVED=true. `check`, `backend` and
 * `frontend-upload` (a version with 0% of traffic) are unaffected; promoting is a separate manual step.
 */
export function checkCutoverStage(stage, approved) {
  if (stage === "frontend" && approved !== "true") {
    return ["stage=frontend goes live immediately with R2-only writes on: it needs the GitHub variable R2_CUTOVER_APPROVED=true (owner's final cutover approval). Use stage=frontend-upload"];
  }
  return [];
}

/**
 * MEDIA MODES for a Production release. The committed config is the FUTURE R2-only cutover state and is never edited to ship an
 * unrelated release. A release picks a mode instead, and the mode's `--var` overrides are applied on the `wrangler` command line
 * (a CLI var wins over the file):
 *   legacy-hold  (default) R2 writes stay OFF and Supabase Storage writes stay open, exactly like the Worker that is live today.
 *   r2-only      no overrides: the committed R2-only flags (the cutover; promotion needs its own approval).
 */
export const MEDIA_MODES = ["legacy-hold", "r2-only"];
export const LEGACY_HOLD_FLAGS = { R2_STORAGE_ENABLED: "false", R2_PRODUCTION_WRITES_APPROVED: "false", MEDIA_LEGACY_STORAGE_WRITES: "true" };

/** The `--var NAME:value` arguments a mode adds to wrangler, one array element each ([] for r2-only). */
export function mediaModeArgs(mode) {
  if (mode === "r2-only") return [];
  if (mode === "legacy-hold") return Object.entries(LEGACY_HOLD_FLAGS).flatMap(([name, value]) => ["--var", `${name}:${value}`]);
  throw new Error(`unknown media mode: ${mode}`);
}

/** The media flags the Worker would carry: the committed vars with the mode's own wrangler arguments applied on top. */
export function effectiveMediaFlags(config, mode) {
  const vars = { ...(config.env?.production?.vars ?? {}) };
  const args = mediaModeArgs(mode);
  for (let i = 0; i < args.length; i += 2) {
    const [name, ...rest] = args[i + 1].split(":");
    vars[name] = rest.join(":");
  }
  return Object.fromEntries(Object.keys(R2_ONLY_FLAGS).map((flag) => [flag, vars[flag]]));
}

/** Refuses a release whose effective media flags are not exactly the mode's promise. Run before anything is uploaded. */
export function checkMediaMode(config, mode) {
  if (!MEDIA_MODES.includes(mode)) return [`media_mode must be one of ${MEDIA_MODES.join(", ")} (got "${mode}")`];
  const want = mode === "r2-only" ? R2_ONLY_FLAGS : LEGACY_HOLD_FLAGS;
  const got = effectiveMediaFlags(config, mode);
  const problems = [];
  for (const [flag, value] of Object.entries(want)) {
    if (got[flag] !== value) problems.push(`media_mode=${mode}: ${flag} would be "${got[flag]}", must be "${value}"`);
  }
  return problems;
}

function main() {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const problems = [
    ...checkFrontend(parseJsonc(readFileSync(`${root}frontend/wrangler.jsonc`, "utf8"))),
    ...checkBackend(parseJsonc(readFileSync(`${root}edge/backend-worker/wrangler.jsonc`, "utf8"))),
  ];
  problems.push(...checkCutoverStage(process.env.STAGE, process.env.R2_CUTOVER_APPROVED));
  if (process.argv.includes("--live-values")) problems.push(...checkLiveValues(process.env));
  // `--media-var-args <mode>`: print the wrangler arguments for the mode, one per line (the workflow reads them with mapfile).
  const argsAt = process.argv.indexOf("--media-var-args");
  const argsMode = argsAt === -1 ? null : process.argv[argsAt + 1];
  if (argsMode !== null) problems.push(...checkMediaMode(parseJsonc(readFileSync(`${root}frontend/wrangler.jsonc`, "utf8")), argsMode));
  // `--verify-media-mode <mode>`: fail unless the effective flags are exactly the mode's promise; print them for the run summary.
  const verifyAt = process.argv.indexOf("--verify-media-mode");
  if (verifyAt !== -1) {
    const mode = process.argv[verifyAt + 1];
    const config = parseJsonc(readFileSync(`${root}frontend/wrangler.jsonc`, "utf8"));
    problems.push(...checkMediaMode(config, mode));
    if (!problems.length) {
      const flags = effectiveMediaFlags(config, mode);
      console.log(`Release media mode: ${mode}`);
      for (const [flag, value] of Object.entries(flags)) console.log(`  ${flag} = ${value}`);
    }
  }
  for (const problem of problems) console.error(`check-cloudflare-production: ${problem}`);
  if (problems.length) process.exit(1);
  if (argsMode !== null) {
    // Machine output only: the workflow reads these lines, so nothing else is printed in this mode.
    for (const arg of mediaModeArgs(argsMode)) console.log(arg);
    return;
  }
  console.log("check-cloudflare-production: OK");
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) main();
