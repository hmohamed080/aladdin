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
 * MEDIA MODES for a Production release. Production is R2-ONLY today (2026-11-12): R2_STORAGE_ENABLED=true, R2_PRODUCTION_WRITES_APPROVED=true,
 * MEDIA_LEGACY_STORAGE_WRITES=false, and Supabase Storage writes must never be re-enabled by a release. A release picks a mode:
 *   match-live  (default) FAIL-CLOSED: reads the ACTIVE Production Worker version(s) from the Cloudflare API, takes their three media flags and
 *               carries exactly those on the command line, so a release of unrelated changes cannot move a media write path. Any problem
 *               (no token, API error, no active version, a flag missing, active versions that disagree) stops the run before anything is built.
 *   r2-only     no overrides: the committed R2-only flags (the cutover config; promotion needs its own approval).
 * In EVERY mode MEDIA_LEGACY_STORAGE_WRITES must be "false": there is no mode that reopens Supabase Storage writes (the old `legacy-hold` mode
 * was removed for that reason). After an upload, `--verify-version <id>` proves the uploaded version carries the live version's flags, and it is
 * the check to run again immediately before promoting.
 */
export const MEDIA_MODES = ["match-live", "r2-only"];
export const MEDIA_FLAGS = Object.keys(R2_ONLY_FLAGS);
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

/** The three media flags carried by a Worker version's bindings (plain text bindings only); a flag that is absent is `undefined`. */
export function mediaFlagsFromBindings(bindings) {
  const flags = Object.fromEntries(MEDIA_FLAGS.map((flag) => [flag, undefined]));
  for (const binding of Array.isArray(bindings) ? bindings : []) {
    if (binding && MEDIA_FLAGS.includes(binding.name) && binding.type === "plain_text" && typeof binding.text === "string") flags[binding.name] = binding.text;
  }
  return flags;
}

async function cloudflareGet(path, { token, base, fetchImpl }) {
  const response = await fetchImpl(`${base}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!response.ok) throw new Error(`Cloudflare API ${path.split("/").slice(-1)[0]} answered HTTP ${response.status}`);
  const body = await response.json();
  if (!body || body.success !== true || typeof body.result !== "object" || body.result === null) throw new Error("Cloudflare API answered an unexpected body");
  return body.result;
}

/** The media flags of one Worker version, read from its bindings. Throws on any API problem; never returns a guess. */
export async function fetchVersionMediaFlags({ accountId, token, worker, versionId, fetchImpl = fetch, base = CLOUDFLARE_API }) {
  if (!accountId || !token || !worker || !versionId) throw new Error("account id, API token, worker name and version id are all required");
  const result = await cloudflareGet(`/accounts/${accountId}/workers/scripts/${worker}/versions/${versionId}`, { token, base, fetchImpl });
  return mediaFlagsFromBindings(result.resources?.bindings);
}

/**
 * The media flags of the ACTIVE Production deployment: every version that serves traffic (percentage > 0) must carry identical, complete flags.
 * Returns { flags, versionIds }. Throws (fail closed) on a missing token, API error, no active version, an incomplete flag set or disagreement.
 */
export async function fetchLiveMediaFlags({ accountId, token, worker, fetchImpl = fetch, base = CLOUDFLARE_API }) {
  if (!accountId || !token || !worker) throw new Error("CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and the Worker name are required to read the live Worker");
  const result = await cloudflareGet(`/accounts/${accountId}/workers/scripts/${worker}/deployments`, { token, base, fetchImpl });
  const active = Array.isArray(result.deployments) ? result.deployments[0] : undefined;
  const versions = (Array.isArray(active?.versions) ? active.versions : []).filter((v) => Number(v?.percentage) > 0 && typeof v?.version_id === "string");
  if (!versions.length) throw new Error(`${worker} has no active deployment with a version serving traffic`);
  const perVersion = [];
  for (const version of versions) {
    perVersion.push(await fetchVersionMediaFlags({ accountId, token, worker, versionId: version.version_id, fetchImpl, base }));
  }
  const first = perVersion[0];
  for (const flag of MEDIA_FLAGS) {
    if (first[flag] !== "true" && first[flag] !== "false") throw new Error(`the live version does not carry ${flag} as "true" or "false" (got ${JSON.stringify(first[flag])})`);
    if (perVersion.some((flags) => flags[flag] !== first[flag])) throw new Error(`the active versions disagree on ${flag}: a gradual rollout with different media flags is in progress`);
  }
  return { flags: first, versionIds: versions.map((v) => v.version_id) };
}

/** The `--var NAME:value` arguments a mode adds to wrangler, one array element each. match-live needs the live flags; r2-only adds none. */
export function mediaModeArgs(mode, liveFlags) {
  if (mode === "r2-only") return [];
  if (mode === "match-live") {
    if (!liveFlags) throw new Error("match-live needs the live Worker's media flags");
    return MEDIA_FLAGS.flatMap((flag) => ["--var", `${flag}:${liveFlags[flag]}`]);
  }
  throw new Error(`unknown media mode: ${mode}`);
}

/** The media flags the Worker would carry: the committed vars with the mode's own wrangler arguments applied on top. */
export function effectiveMediaFlags(config, mode, liveFlags) {
  const vars = { ...(config.env?.production?.vars ?? {}) };
  const args = mediaModeArgs(mode, liveFlags);
  for (let i = 0; i < args.length; i += 2) {
    const [name, ...rest] = args[i + 1].split(":");
    vars[name] = rest.join(":");
  }
  return Object.fromEntries(MEDIA_FLAGS.map((flag) => [flag, vars[flag]]));
}

/** Refuses a release whose effective media flags are not the mode's promise, or that would ever reopen Supabase Storage writes. */
export function checkMediaMode(config, mode, liveFlags) {
  if (!MEDIA_MODES.includes(mode)) return [`media_mode must be one of ${MEDIA_MODES.join(", ")} (got "${mode}")`];
  if (mode === "match-live" && !liveFlags) return ["media_mode=match-live: the live Worker's media flags could not be read, so nothing is uploaded"];
  const got = effectiveMediaFlags(config, mode, liveFlags);
  const problems = [];
  if (got.MEDIA_LEGACY_STORAGE_WRITES !== "false") {
    problems.push(`media_mode=${mode}: MEDIA_LEGACY_STORAGE_WRITES would be "${got.MEDIA_LEGACY_STORAGE_WRITES}": a release never reopens Supabase Storage writes`);
  }
  if (mode === "r2-only") {
    for (const [flag, value] of Object.entries(R2_ONLY_FLAGS)) {
      if (got[flag] !== value) problems.push(`media_mode=r2-only: ${flag} would be "${got[flag]}", must be "${value}"`);
    }
  } else {
    for (const flag of MEDIA_FLAGS) {
      if (got[flag] !== liveFlags[flag]) problems.push(`media_mode=match-live: ${flag} would be "${got[flag]}", the live Worker has "${liveFlags[flag]}"`);
    }
  }
  return problems;
}

/** Proves an uploaded (or about to be promoted) version carries exactly the live flags, and never legacy writes. Returns problems. */
export function checkVersionMatchesLive(versionFlags, liveFlags) {
  const problems = [];
  for (const flag of MEDIA_FLAGS) {
    if (versionFlags[flag] !== liveFlags[flag]) problems.push(`${flag} is ${JSON.stringify(versionFlags[flag])} on the version but ${JSON.stringify(liveFlags[flag])} on the live Worker`);
  }
  if (versionFlags.MEDIA_LEGACY_STORAGE_WRITES !== "false") problems.push(`MEDIA_LEGACY_STORAGE_WRITES is ${JSON.stringify(versionFlags.MEDIA_LEGACY_STORAGE_WRITES)} on the version: it must be "false"`);
  return problems;
}

function liveReadParams(config) {
  const worker = config.env?.production?.name;
  return {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
    worker,
    // The API base is overridable ONLY so the tests can point it at a local stand-in; the workflow never sets it.
    base: process.env.CLOUDFLARE_API_BASE || CLOUDFLARE_API,
  };
}

async function main() {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const frontendConfig = parseJsonc(readFileSync(`${root}frontend/wrangler.jsonc`, "utf8"));
  const problems = [
    ...checkFrontend(frontendConfig),
    ...checkBackend(parseJsonc(readFileSync(`${root}edge/backend-worker/wrangler.jsonc`, "utf8"))),
  ];
  problems.push(...checkCutoverStage(process.env.STAGE, process.env.R2_CUTOVER_APPROVED));
  if (process.argv.includes("--live-values")) problems.push(...checkLiveValues(process.env));

  const argAfter = (flag) => {
    const at = process.argv.indexOf(flag);
    return at === -1 ? null : process.argv[at + 1];
  };
  const argsMode = argAfter("--media-var-args");
  const verifyMode = argAfter("--verify-media-mode");
  const versionId = argAfter("--verify-version");
  const mode = argsMode ?? verifyMode;

  // match-live reads the ACTIVE Production version; any failure leaves `live` undefined and checkMediaMode refuses.
  let live;
  if (mode === "match-live" || versionId !== null) {
    try {
      live = await fetchLiveMediaFlags(liveReadParams(frontendConfig));
    } catch (error) {
      problems.push(`cannot read the live Worker: ${error.message}`);
    }
  }
  if (mode !== null) problems.push(...checkMediaMode(frontendConfig, mode, live?.flags));
  if (mode !== null && !problems.length && verifyMode !== null) {
    console.log(`Release media mode: ${mode}`);
    if (live) console.log(`  live version(s): ${live.versionIds.join(", ")}`);
    for (const [flag, value] of Object.entries(effectiveMediaFlags(frontendConfig, mode, live?.flags))) console.log(`  ${flag} = ${value}`);
  }
  if (versionId !== null && live) {
    try {
      const uploaded = await fetchVersionMediaFlags({ ...liveReadParams(frontendConfig), versionId });
      problems.push(...checkVersionMatchesLive(uploaded, live.flags).map((problem) => `version ${versionId}: ${problem}`));
      if (!problems.length) {
        console.log(`Version ${versionId} carries the live media flags (live version(s): ${live.versionIds.join(", ")}):`);
        for (const [flag, value] of Object.entries(uploaded)) console.log(`  ${flag} = ${value}`);
      }
    } catch (error) {
      problems.push(`cannot read version ${versionId}: ${error.message}`);
    }
  }
  for (const problem of problems) console.error(`check-cloudflare-production: ${problem}`);
  if (problems.length) process.exit(1);
  if (argsMode !== null) {
    // Machine output only: the workflow reads these lines, so nothing else is printed in this mode.
    for (const arg of mediaModeArgs(argsMode, live?.flags)) console.log(arg);
    return;
  }
  if (verifyMode === null && versionId === null) console.log("check-cloudflare-production: OK");
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`check-cloudflare-production: ${error.message}`);
    process.exit(1);
  });
}
