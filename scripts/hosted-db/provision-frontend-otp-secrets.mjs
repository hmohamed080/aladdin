#!/usr/bin/env node
// OWNER-RUN, PRODUCTION, P-4 of docs/operations/WHATSAPP_OTP_PRODUCTION_ROLLOUT_CHECKLIST.md.
//
// Adds the WhatsApp OTP secrets to the Production frontend Worker (aladdin-frontend-production) as ONE NEW, UNDEPLOYED version (0% of traffic),
// without ever writing a secret to disk, to a command line, an environment variable or a log:
//
//   node scripts/hosted-db/provision-frontend-otp-secrets.mjs            PREFLIGHT ONLY (default): read-only checks, no prompts, nothing created
//   node scripts/hosted-db/provision-frontend-otp-secrets.mjs --apply    hidden prompts, then `wrangler versions secret bulk` fed through stdin
//
// What it does, in order (any failed check stops the run before anything is created):
//   1. PREFLIGHT (read-only): the deployment is exactly ONE version at 100% and it is the expected live version; that version is also the
//      LATEST uploaded version (`versions secret bulk` patches the latest version, so latest must equal live); none of the four names exist yet.
//      The live version's bindings are recorded as the baseline.
//   2. (--apply) three HIDDEN prompts, each typed twice: PHONE_OTP_ADMIN_SECRET, PHONE_OTP_NOTIFY_SECRET, PHONE_OTP_WORKER_SECRET. Each must be a
//      whsec_ value of at least 32 bytes with real entropy (same rule as the grant key), the three must differ from each other, and none may
//      be the Production grant key (its 12-hex fingerprint is pinned below): OTP_ADMIN_GRANT_SECRET_PRODUCTION is never reused. Only 12-hex
//      fingerprints are printed, for your own record; they are hashes, not the values.
//   3. The preflight runs again immediately before the write (the live version must still be at 100%).
//   4. `wrangler versions secret bulk --env production --tag p4-otp-secrets` with the JSON on STDIN (in memory only; wrangler's own output is
//      printed with every secret value redacted).
//   5. POSTFLIGHT (read-only): the deployment is unchanged (still the one live version at 100%); exactly ONE new version exists and is not in
//      the deployment; its bindings are the baseline plus exactly the four new names (all other secrets, vars and service bindings deep-equal)
//      and its runtime settings are unchanged. Nothing is promoted: promoting is a separate, separately approved step.
//
// PHONE_OTP_WORKER_URL is the fixed placeholder below (a hostname that is never resolved: the frontend reaches the Worker through its private
// OTP_WORKER service binding and only uses this value's origin to build the signed request path).
// The values cannot be compared with their Secrets Store twins from here (a Secrets Store value cannot be read back). Paste the SAME password
// manager entries that created OTP_ADMIN_SIGNING_SECRET_PRODUCTION, OTP_NOTIFY_SIGNING_SECRET_PRODUCTION and PHONE_OTP_WORKER_SECRET_PRODUCTION.
// Exit codes: 0 done / preflight passed, 1 refused or failed safely, 2 usage.
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { fingerprint, readHidden, validateGrantKey } from "./provision-grant-key/provision-grant-key.mjs";

export const WORKER_ENV = "production";
export const LIVE_VERSION = "a3b08a22-f82e-4851-9786-9442c01e43c8";
export const GRANT_KEY_FP12 = "f52afdd8b900"; // P-1, 2026-11-07
export const PLACEHOLDER_URL = "https://aladdin-whatsapp-otp.internal/v1/otp/send";
export const SECRET_NAMES = ["PHONE_OTP_ADMIN_SECRET", "PHONE_OTP_NOTIFY_SECRET", "PHONE_OTP_WORKER_SECRET"];
export const URL_NAME = "PHONE_OTP_WORKER_URL";
export const NEW_NAMES = [...SECRET_NAMES, URL_NAME];
export const TAG = "p4-otp-secrets";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, "..", "..", "frontend");

const same = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
export const redact = (text, secrets) => {
  let out = String(text ?? "");
  for (const s of secrets) if (s && String(s).length >= 6) out = out.split(String(s)).join("[redacted]");
  return out;
};

/** deployment = `deployments status --json`; versions = `versions list --json`; baseline = `versions view <live> --json`. */
export function checkPreflight({ deployment, versions, baseline, live = LIVE_VERSION }) {
  const p = [];
  const dv = deployment?.versions ?? [];
  if (dv.length !== 1 || dv[0].version_id !== live || dv[0].percentage !== 100) {
    p.push(`the deployment is not exactly ${live} at 100% (found: ${dv.map((v) => `${v.version_id} ${v.percentage}%`).join(", ") || "none"})`);
  }
  const list = Array.isArray(versions) ? versions : [];
  const latest = [...list].sort((a, b) => (a.number ?? 0) - (b.number ?? 0)).at(-1);
  if (!latest || latest.id !== live) p.push(`the latest uploaded version is ${latest?.id ?? "none"}, not the live ${live}: \`versions secret bulk\` patches the latest version, so stop`);
  const names = new Set((baseline?.resources?.bindings ?? []).map((b) => b.name));
  if (!names.size) p.push("could not read the live version's bindings");
  for (const n of NEW_NAMES) if (names.has(n)) p.push(`${n} already exists on the live version`);
  for (const n of names) if (/^OTP_ADMIN_GRANT_SECRET/.test(n)) p.push(`${n} must never be on the frontend`);
  return p;
}

/** values = { PHONE_OTP_ADMIN_SECRET, ... } exactly as typed. Returns { problems, fps }. Never echoes a value. */
export function checkEntries(values, grantFp = GRANT_KEY_FP12) {
  const problems = [];
  const fps = {};
  const seen = new Map();
  for (const n of SECRET_NAMES) {
    const r = validateGrantKey(values[n]);
    if (r.error) { problems.push(`${n}: not a valid whsec_ secret (${r.error})`); continue; }
    const fp = fingerprint(r.bytes).slice(0, 12);
    fps[n] = fp;
    if (fp === grantFp) problems.push(`${n}: equals the Production grant key; OTP_ADMIN_GRANT_SECRET_PRODUCTION must never be reused`);
    if (seen.has(fp)) problems.push(`${n}: identical to ${seen.get(fp)}; the three secrets must differ`);
    seen.set(fp, n);
  }
  return { problems, fps };
}

/** after = { deployment, versions, newView }. */
export function checkPostflight({ before, after, baseline, live = LIVE_VERSION }) {
  const p = [];
  const dv = after.deployment?.versions ?? [];
  if (dv.length !== 1 || dv[0].version_id !== live || dv[0].percentage !== 100) p.push("the live deployment CHANGED: stop and investigate");
  if (before.deployment?.id && after.deployment?.id !== before.deployment.id) p.push("a new deployment was created");
  const was = new Set((before.versions ?? []).map((v) => v.id));
  const added = (after.versions ?? []).filter((v) => !was.has(v.id));
  if (added.length !== 1) p.push(`expected exactly one new version, found ${added.length}`);
  const nv = after.newView;
  if (added.length === 1 && dv.some((v) => v.version_id === added[0].id)) p.push("the new version is in the deployment");
  if (!nv) { p.push("could not read the new version"); return p; }
  const oldB = new Map((baseline.resources?.bindings ?? []).map((b) => [b.name, b]));
  const newB = new Map((nv.resources?.bindings ?? []).map((b) => [b.name, b]));
  for (const [n, b] of oldB) {
    if (!newB.has(n)) p.push(`binding ${n} was LOST`);
    else if (!same(b, newB.get(n))) p.push(`binding ${n} CHANGED`);
  }
  const extra = [...newB.keys()].filter((n) => !oldB.has(n)).sort();
  if (!same(extra, [...NEW_NAMES].sort())) p.push(`new bindings are [${extra.join(", ")}], expected exactly [${[...NEW_NAMES].sort().join(", ")}]`);
  for (const n of NEW_NAMES) if (newB.has(n) && newB.get(n).type !== "secret_text") p.push(`${n} is not a secret_text binding`);
  if (!same(nv.resources?.script_runtime, baseline.resources?.script_runtime)) p.push("the runtime settings (script_runtime) changed");
  return p;
}

const parse = (r, what) => {
  if (r.status !== 0) throw new Error(`${what} failed (exit ${r.status})`);
  const t = String(r.stdout);
  const starts = ["{", "["].map((c) => t.indexOf(c)).filter((i) => i >= 0);
  if (!starts.length) throw new Error(`${what} returned no JSON`);
  return JSON.parse(t.slice(Math.min(...starts)));
};

/** Safe recovery text. It never retries and never promotes; every command is read-only unless it says otherwise. */
export function recovery(newIds, live = LIVE_VERSION) {
  const ids = newIds.length ? newIds.join(", ") : "none found";
  return [
    `New version id(s): ${ids}. They are NOT promoted by this script and it will NOT retry.`,
    "Safe recovery (do not re-run --apply until you understand the state):",
    "  1. Confirm the live deployment: cd frontend && pnpm exec wrangler deployments status --env production   (must show only the live version at 100%).",
    "  2. Inspect each new version: pnpm exec wrangler versions view <id> --env production   (read-only).",
    `  3. An undeployed version serves no traffic and is harmless; leave it, never deploy it. If the live deployment is NOT ${live.slice(0, 8)} at 100%: pnpm exec wrangler rollback ${live} --env production (needs approval), then stop.`,
    "  4. To remove the names later, use `wrangler versions secret delete <NAME> --env production` (creates another undeployed version) after review.",
  ].join("\n");
}

/** After a nonzero wrangler exit: a read-only look at deployments and versions, then an honest verdict. */
export function verifyAfterFailure({ read, before, live }) {
  let after;
  try {
    after = read();
  } catch (e) {
    return `COULD NOT VERIFY (${e.message}). Do not assume nothing was created: from frontend/ run, read-only, 'wrangler deployments status --env production' and 'wrangler versions list --env production' and compare with the version list before (latest was ${live}).`;
  }
  const added = after.versions.filter((v) => !before.versions.some((o) => o.id === v.id));
  const dv = after.deployment?.versions ?? [];
  const depOk = dv.length === 1 && dv[0].version_id === live && dv[0].percentage === 100;
  const depLine = depOk ? `Verified: the live deployment is unchanged (${live.slice(0, 8)} at 100%).` : "WARNING: the live deployment is NOT the single expected version at 100%: investigate before anything else.";
  if (added.length === 0) return `FAILED. Verified read-only: no new version exists (version list unchanged). ${depLine} Nothing to clean up.`;
  return `FAILED, but ${added.length} NEW VERSION(S) EXIST despite the error. ${depLine}\n${recovery(added.map((v) => v.id), live)}`;
}

export async function run({ argv, wrangler, hidden, out, ci = false, isTTY = true, live = LIVE_VERSION }) {
  const apply = argv.includes("--apply");
  const bad = argv.filter((a) => a !== "--apply");
  if (bad.length) { out(`unexpected argument: ${bad[0]}`); return 2; }
  const secrets = [];
  let maybeWrote = false; // set just before the write: from then on, an unexpected error must be followed by a read-only look
  let ctx = null;
  const refuse = (msg) => { out(redact(msg, secrets)); return 1; };
  try {
    if (apply && ci) return refuse("REFUSED: never in CI");
    if (apply && !isTTY) return refuse("REFUSED: an interactive terminal is required (hidden prompts)");

    const read = () => ({
      deployment: parse(wrangler(["deployments", "status", "--env", WORKER_ENV, "--json"]), "deployments status"),
      versions: parse(wrangler(["versions", "list", "--env", WORKER_ENV, "--json"]), "versions list"),
    });
    out(`[1/5] preflight (read-only): ${WORKER_ENV}`);
    const before = read();
    const baseline = parse(wrangler(["versions", "view", live, "--env", WORKER_ENV, "--json"]), "versions view");
    const pre = checkPreflight({ ...before, baseline, live });
    if (pre.length) return refuse(`REFUSED:\n${pre.map((x) => `  - ${x}`).join("\n")}`);
    out(`      live ${live.slice(0, 8)} is the only deployed version at 100% and the latest version; ${baseline.resources.bindings.length} bindings recorded; none of the 4 new names exist.`);
    if (!apply) { out("Preflight passed. Nothing was created. Re-run with --apply to enter the values."); return 0; }

    out("[2/5] values (hidden prompts, each typed twice; nothing is echoed or stored)");
    const values = {};
    for (const n of SECRET_NAMES) {
      const a = await hidden(`${n}: `); secrets.push(a, String(a).trim());
      const b = await hidden(`${n} (again): `); secrets.push(b);
      if (a !== b) return refuse(`REFUSED: the two entries of ${n} differ; nothing was created`);
      values[n] = String(a).trim();
    }
    const entries = checkEntries(values);
    if (entries.problems.length) return refuse(`REFUSED:\n${entries.problems.map((x) => `  - ${x}`).join("\n")}\nNothing was created.`);
    for (const n of SECRET_NAMES) out(`      ${n}: accepted, fingerprint ${entries.fps[n]} (a hash for your own record, not the value)`);

    out("[3/5] preflight again, immediately before the write");
    const again = read();
    const pre2 = checkPreflight({ ...again, baseline, live });
    if (pre2.length) return refuse(`REFUSED:\n${pre2.map((x) => `  - ${x}`).join("\n")}`);

    out("[4/5] creating ONE undeployed version (secrets passed on stdin)");
    maybeWrote = true; ctx = { read, before };
    const payload = JSON.stringify({ ...values, [URL_NAME]: PLACEHOLDER_URL });
    secrets.push(payload);
    const w = wrangler(["versions", "secret", "bulk", "--env", WORKER_ENV, "--tag", TAG, "--message", "P-4-otp-secrets-not-deployed"], { input: payload });
    out(redact(`${w.stdout ?? ""}${w.stderr ?? ""}`, secrets).trim());
    if (w.status !== 0) {
      // A nonzero exit does not prove that nothing was created: look, read-only, before saying anything about it.
      out(`wrangler exited with code ${w.status}. Verifying read-only what exists (not assuming)...`);
      return refuse(verifyAfterFailure({ read, before, live }));
    }

    out("[5/5] postflight (read-only)");
    const after = read();
    const added = after.versions.filter((v) => !before.versions.some((o) => o.id === v.id));
    const newView = added.length === 1 ? parse(wrangler(["versions", "view", added[0].id, "--env", WORKER_ENV, "--json"]), "versions view (new)") : null;
    const post = checkPostflight({ before, after: { ...after, newView }, baseline, live });
    if (post.length) return refuse(`POSTFLIGHT PROBLEMS after a successful upload:\n${post.map((x) => `  - ${x}`).join("\n")}\n${recovery(added.map((v) => v.id), live)}`);
    out(`Done. New version ${added[0].id} (tag ${TAG}) is NOT deployed. Live ${live.slice(0, 8)} is still 100%. Bindings preserved; added exactly: ${NEW_NAMES.join(", ")}.`);
    out("Record the version id and the three fingerprints in the release record. Do NOT promote it.");
    return 0;
  } catch (e) {
    if (maybeWrote && ctx) return refuse(`An unexpected error occurred after the write began (${e.message}). Not assuming anything: ${verifyAfterFailure({ ...ctx, live })}`);
    return refuse(`FAILED safely: ${e.message}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const wrangler = (args, opts = {}) =>
    spawnSync("pnpm", ["exec", "wrangler", ...args], { cwd: FRONTEND, input: opts.input, encoding: "utf8", shell: process.platform === "win32", maxBuffer: 32 * 1024 * 1024 });
  run({ argv: process.argv.slice(2), wrangler, hidden: (p) => readHidden(p), out: (s) => console.log(s), ci: Boolean(process.env.CI), isTTY: Boolean(process.stdin.isTTY) })
    .then((code) => { process.exitCode = code; }, () => { process.exitCode = 1; });
}
