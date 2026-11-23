#!/usr/bin/env node
// OWNER-RUN, PRODUCTION. Adds the FIVE secrets the new phone sign-up needs to the Production frontend Worker (aladdin-frontend-production)
// as ONE NEW, UNDEPLOYED version (0% of traffic), after P-4 (checklist section "Production phone sign-up secrets (5)").
//
//   node scripts/hosted-db/provision-frontend-signup-secrets.mjs            DRY RUN (default): read-only checks, lists the NAMES it would set, writes nothing
//   node scripts/hosted-db/provision-frontend-signup-secrets.mjs --apply    typed confirmation, then `wrangler versions secret bulk` fed through stdin
//
// Names (frontend/src/lib/env/phone-verification.ts has the exact rules):
//   PHONE_OTP_DELIVERY                 fixed literal "worker"
//   PHONE_VERIFICATION_ENABLED         fixed literal "true"
//   PHONE_SIGNUP_VERIFICATION_ENABLED  fixed literal "true"
//   PHONE_OTP_HMAC_KEYS                {"current":"<fresh kid>","keys":{"<kid>":"<base64 of 32 random bytes>"}}   (generated in memory)
//   PHONE_SIGNUP_COOKIE_SECRET         48 random bytes, base64url = 64 chars                                        (generated in memory)
// The secrets are generated HERE, in this process's memory (crypto.randomBytes), piped to wrangler on stdin, and never printed, logged,
// written to disk, put on a command line or in an environment variable. Only names are ever printed. The two random values cannot be read
// back afterwards: that is by design (nobody needs them; rotating means running this again after deleting the names).
//
// The database switches (app.phone_verification_config.enabled / signup_enabled, default false) stay the real instant gate. These frontend
// switches are inert for the currently live frontend (it ignores them) and only matter once the new frontend is promoted.
//
// Guards (any failure stops before anything is created):
//   - target is hard-coded to --env production; never in CI; apply needs an interactive terminal
//   - the deployment is exactly the live version at 100% alone (LIVE_VERSION a3b08a22)
//   - the LATEST uploaded version is the P-4 version (`versions secret bulk` patches the latest version, and the P-4 version already carries the
//     four PHONE_OTP_* secrets, so the new version = P-4 + the five); the four P-4 names are present as secret_text; none of the five exist yet
//   - typed confirmation phrase naming the Production frontend (CONFIRM_PHRASE)
//   - preflight again immediately before the write
//   - postflight (read-only): deployment unchanged, exactly one new version, not deployed, bindings = P-4 baseline + exactly the five names
//     (all secret_text), runtime settings and script identity unchanged
// Nothing is promoted. Exit codes: 0 done / dry run passed, 1 refused or failed safely, 2 usage.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  LIVE_VERSION, NEW_NAMES, P4_VERSION, SIGNUP_SECRET_NAMES, WORKER_ENV, checkNewVersionContents, recovery, redact, spawnWrangler, verifyAfterFailure,
} from "./provision-frontend-otp-secrets.mjs";
import readline from "node:readline/promises";

export const TAG = "p4b-signup-secrets";
export const WORKER_NAME = "aladdin-frontend-production";
export const CONFIRM_PHRASE = `SET 5 PHONE SIGNUP SECRETS ON ${WORKER_NAME}`;
export const FIXED = { PHONE_OTP_DELIVERY: "worker", PHONE_VERIFICATION_ENABLED: "true", PHONE_SIGNUP_VERIFICATION_ENABLED: "true" };

/** Builds the five values in memory. `random` is injectable for tests only (default: crypto.randomBytes). Returns { values, kid }. */
export function generateValues(random = randomBytes) {
  const kid = `k${random(6).toString("hex")}`;
  const keyring = JSON.stringify({ current: kid, keys: { [kid]: random(32).toString("base64") } });
  const values = { ...FIXED, PHONE_OTP_HMAC_KEYS: keyring, PHONE_SIGNUP_COOKIE_SECRET: random(48).toString("base64url") };
  return { values, kid };
}

const okDeployment = (d, live) => { const dv = d?.versions ?? []; return dv.length === 1 && dv[0].version_id === live && dv[0].percentage === 100; };

/** deployment = `deployments status --json`; versions = `versions list --json`; baseline = `versions view <P-4> --json`. */
export function checkPreflight({ deployment, versions, baseline, live = LIVE_VERSION, p4 = P4_VERSION }) {
  const p = [];
  const dv = deployment?.versions ?? [];
  if (!okDeployment(deployment, live)) p.push(`the deployment is not exactly ${live} at 100% (found: ${dv.map((v) => `${v.version_id} ${v.percentage}%`).join(", ") || "none"})`);
  const latest = [...(Array.isArray(versions) ? versions : [])].sort((a, b) => (a.number ?? 0) - (b.number ?? 0)).at(-1);
  if (!latest || latest.id !== p4) p.push(`the latest uploaded version is ${latest?.id ?? "none"}, not the P-4 version ${p4}: \`versions secret bulk\` patches the latest version, so stop`);
  const bind = new Map((baseline?.resources?.bindings ?? []).map((b) => [b.name, b]));
  if (!bind.size) p.push("could not read the P-4 version's bindings");
  for (const n of NEW_NAMES) if (bind.size && bind.get(n)?.type !== "secret_text") p.push(`${n} is not a secret_text binding on the P-4 version (P-4 incomplete)`);
  for (const n of SIGNUP_SECRET_NAMES) if (bind.has(n)) p.push(`${n} already exists on the P-4 version`);
  for (const n of bind.keys()) if (/^OTP_ADMIN_GRANT_SECRET/.test(n)) p.push(`${n} must never be on the frontend`);
  return p;
}

/** after = { deployment, versions, newView }. */
export function checkPostflight({ before, after, baseline, live = LIVE_VERSION }) {
  const p = [];
  const dv = after.deployment?.versions ?? [];
  if (!okDeployment(after.deployment, live)) p.push("the live deployment CHANGED: stop and investigate");
  if (before.deployment?.id && after.deployment?.id !== before.deployment.id) p.push("a new deployment was created");
  const was = new Set((before.versions ?? []).map((v) => v.id));
  const added = (after.versions ?? []).filter((v) => !was.has(v.id));
  if (added.length !== 1) p.push(`expected exactly one new version, found ${added.length}`);
  if (added.length === 1 && dv.some((v) => v.version_id === added[0].id)) p.push("the new version is in the deployment");
  if (!after.newView) { p.push("could not read the new version"); return p; }
  return [...p, ...checkNewVersionContents({ baseline, nv: after.newView, names: SIGNUP_SECRET_NAMES })];
}

const parse = (r, what) => {
  if (r.status !== 0) throw new Error(`${what} failed (exit ${r.status})`);
  const t = String(r.stdout);
  const starts = ["{", "["].map((c) => t.indexOf(c)).filter((i) => i >= 0);
  if (!starts.length) throw new Error(`${what} returned no JSON`);
  return JSON.parse(t.slice(Math.min(...starts)));
};

export async function run({ argv, wrangler, confirm, out, random = randomBytes, ci = false, isTTY = true, live = LIVE_VERSION, p4 = P4_VERSION }) {
  const apply = argv.includes("--apply");
  const bad = argv.filter((a) => a !== "--apply");
  if (bad.length) { out(`unexpected argument: ${bad[0]}`); return 2; }
  const secrets = [];
  let maybeWrote = false;
  let ctx = null;
  const refuse = (msg) => { out(redact(msg, secrets)); return 1; };
  try {
    if (apply && ci) return refuse("REFUSED: never in CI");
    if (apply && !isTTY) return refuse("REFUSED: an interactive terminal is required (typed confirmation)");
    const read = () => ({
      deployment: parse(wrangler(["deployments", "status", "--env", WORKER_ENV, "--json"]), "deployments status"),
      versions: parse(wrangler(["versions", "list", "--env", WORKER_ENV, "--json"]), "versions list"),
    });
    out(`[1/5] preflight (read-only): ${WORKER_ENV} (${WORKER_NAME})`);
    const before = read();
    const baseline = parse(wrangler(["versions", "view", p4, "--env", WORKER_ENV, "--json"]), "versions view (P-4)");
    const pre = checkPreflight({ ...before, baseline, live, p4 });
    if (pre.length) return refuse(`REFUSED:\n${pre.map((x) => `  - ${x}`).join("\n")}`);
    out(`      live ${live.slice(0, 8)} is alone at 100%; the latest version is P-4 ${p4.slice(0, 8)} with its 4 OTP secrets; none of the 5 names exist.`);
    out(`      WOULD set (names only), as ONE undeployed version (tag ${TAG}): ${SIGNUP_SECRET_NAMES.join(", ")}`);
    if (!apply) { out("DRY RUN: nothing was created. Re-run with --apply to confirm and create the version."); return 0; }

    out(`[2/5] typed confirmation. Type exactly:  ${CONFIRM_PHRASE}`);
    const typed = String(await confirm("confirmation: ")).trim();
    if (typed !== CONFIRM_PHRASE) return refuse("REFUSED: the confirmation phrase did not match; nothing was created");

    const { values } = generateValues(random);
    const payload = JSON.stringify(values);
    // whole payload first, then each piece (raw and JSON-escaped), so any partial echo is redacted too
    secrets.push(payload, JSON.stringify(values.PHONE_OTP_HMAC_KEYS).slice(1, -1), values.PHONE_OTP_HMAC_KEYS, values.PHONE_SIGNUP_COOKIE_SECRET, ...Object.values(JSON.parse(values.PHONE_OTP_HMAC_KEYS).keys));
    out("[3/5] values generated in memory (nothing printed, stored or echoed); preflight again, immediately before the write");
    const again = read();
    const pre2 = checkPreflight({ ...again, baseline, live, p4 });
    if (pre2.length) return refuse(`REFUSED:\n${pre2.map((x) => `  - ${x}`).join("\n")}`);

    out("[4/5] creating ONE undeployed version (values on stdin)");
    maybeWrote = true; ctx = { read, before };
    const w = wrangler(["versions", "secret", "bulk", "--env", WORKER_ENV, "--tag", TAG, "--message", "P-4b-signup-secrets-not-deployed"], { input: payload });
    out(redact(`${w.stdout ?? ""}${w.stderr ?? ""}`, secrets).trim());
    if (w.status !== 0) {
      out(`wrangler exited with code ${w.status}. Verifying read-only what exists (not assuming)...`);
      return refuse(verifyAfterFailure({ read, before, live }));
    }

    out("[5/5] postflight (read-only, names only)");
    const after = read();
    const added = after.versions.filter((v) => !before.versions.some((o) => o.id === v.id));
    const newView = added.length === 1 ? parse(wrangler(["versions", "view", added[0].id, "--env", WORKER_ENV, "--json"]), "versions view (new)") : null;
    const post = checkPostflight({ before, after: { ...after, newView }, baseline, live });
    if (post.length) return refuse(`POSTFLIGHT PROBLEMS after a successful write:\n${post.map((x) => `  - ${x}`).join("\n")}\n${recovery(added.map((v) => v.id), live)}`);
    out(`Done. New version ${added[0].id} (tag ${TAG}) is NOT deployed. Live ${live.slice(0, 8)} is still 100%. Confirmed on it, by name, as secret_text: ${SIGNUP_SECRET_NAMES.join(", ")}.`);
    out("Record the version id. Do NOT promote it. Next: dispatch the 0% frontend-upload (it carries these secrets from the latest version), then verify-frontend-upload.mjs.");
    return 0;
  } catch (e) {
    if (maybeWrote && ctx) return refuse(`An unexpected error occurred after the write began (${e.message}). Not assuming anything: ${verifyAfterFailure({ ...ctx, live })}`);
    return refuse(`FAILED safely: ${e.message}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const wrangler = (args, opts = {}) => spawnWrangler(args, opts, spawnSync, process.env);
  run({ argv: process.argv.slice(2), wrangler, confirm: async (p) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); try { return await rl.question(p); } finally { rl.close(); } }, out: (s) => console.log(s), ci: Boolean(process.env.CI), isTTY: Boolean(process.stdin.isTTY) })
    .then((code) => { process.exitCode = code; }, () => { process.exitCode = 1; });
}
