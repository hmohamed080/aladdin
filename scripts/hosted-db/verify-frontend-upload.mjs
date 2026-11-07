#!/usr/bin/env node
// READ-ONLY verification of the Production frontend version uploaded by `cloudflare-production` stage=frontend-upload (checklist P-7).
// It never uploads, deploys, rolls back, writes a secret or sends anything: only `deployments status` and `versions view`.
//
//   node scripts/hosted-db/verify-frontend-upload.mjs --version=<uploaded version id>
//
// The uploaded version U must equal the P-4 version (live bindings + the four PHONE_OTP_* secrets) PLUS exactly one new binding:
// the private service binding OTP_WORKER -> aladdin-whatsapp-otp-production. Checked by NAME and TYPE (secret values are never visible):
//   - secret_text names of U == those of the P-4 version (nothing lost, nothing extra, the 4 new ones present)
//   - plain_text names of U == those of the live version, with identical public values (values are never printed)
//   - service / assets / images / version_metadata bindings of the live version unchanged; OTP_WORKER added, targeting production
//   - no PHONE_* or WHATSAPP_* switch among the plain variables (the feature stays OFF)
//   - the live version is still alone at 100% and U is NOT part of the deployment
// Exit 0 = all checks passed, 1 = a check failed or could not be completed, 2 = usage.
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { LIVE_VERSION, NEW_NAMES, safeWranglerEnv } from "./provision-frontend-otp-secrets.mjs";

export const P4_VERSION = "3fc37397-9157-4fa6-8fce-d32dffe0a194";
export const OTP_WORKER_TARGET = "aladdin-whatsapp-otp-production";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.join(HERE, "..", "..", "frontend");

const byName = (v) => new Map((v?.resources?.bindings ?? []).map((b) => [b.name, b]));
const names = (m, type) => [...m.values()].filter((b) => b.type === type).map((b) => b.name).sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** live / p4 / up = `versions view --json` of the live version, the P-4 version and the uploaded version. */
export function checkUpload({ live, p4, up, deployment, versionId }) {
  const p = [];
  const L = byName(live), P = byName(p4), U = byName(up);
  if (!U.size) return ["the uploaded version has no bindings (wrong version id?)"];
  if (versionId === LIVE_VERSION || versionId === P4_VERSION) p.push("the version to verify is the live or the P-4 version, not a new upload");

  const upSecrets = names(U, "secret_text"), p4Secrets = names(P, "secret_text");
  for (const n of p4Secrets) if (!U.has(n)) p.push(`secret ${n} is MISSING on the uploaded version`);
  for (const n of upSecrets) if (!P.has(n)) p.push(`unexpected secret ${n} on the uploaded version`);
  for (const n of NEW_NAMES) if (U.get(n)?.type !== "secret_text") p.push(`${n} must be a secret_text binding on the uploaded version`);
  for (const n of ["AUTH_PASSWORD_PREVIEW_GRANT_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "TURNSTILE_SECRET_KEY", "RESEND_API_KEY"]) if (U.get(n)?.type !== "secret_text") p.push(`existing secret ${n} must still be secret_text`);
  if (!same(upSecrets, p4Secrets)) p.push(`secret names differ from the P-4 version (uploaded: ${upSecrets.length}, P-4: ${p4Secrets.length})`);

  const upPlain = names(U, "plain_text"), livePlain = names(L, "plain_text");
  if (!same(upPlain, livePlain)) p.push(`plain variable names differ from the live version (added: [${upPlain.filter((n) => !L.has(n)).join(", ")}], removed: [${livePlain.filter((n) => !U.has(n)).join(", ")}])`);
  for (const n of livePlain) if (U.has(n) && U.get(n).type === "plain_text" && U.get(n).text !== L.get(n).text) p.push(`variable ${n} changed from the live version`);
  for (const n of upPlain) if (/^(PHONE_|WHATSAPP_|OTP_)/.test(n)) p.push(`variable ${n}: no PHONE_/WHATSAPP_/OTP_ switch may be a plain variable (feature stays OFF)`);

  for (const [n, b] of L) {
    if (b.type === "plain_text" || b.type === "secret_text") continue;
    const u = U.get(n);
    if (!u) p.push(`binding ${n} was LOST`);
    else if (u.type !== b.type || (b.type === "service" && (u.service !== b.service || u.environment !== b.environment))) p.push(`binding ${n} CHANGED (${b.type})`);
  }
  const o = U.get("OTP_WORKER");
  if (!o || o.type !== "service" || o.service !== OTP_WORKER_TARGET || (o.environment !== undefined && o.environment !== "production")) p.push(`OTP_WORKER must be a service binding to ${OTP_WORKER_TARGET} (production)`);
  const added = [...U.keys()].filter((n) => !L.has(n) && !P.has(n)).sort();
  if (!same(added, ["OTP_WORKER"])) p.push(`new bindings beyond the live and P-4 versions are [${added.join(", ")}], expected exactly [OTP_WORKER]`);

  const dep = deployment?.versions ?? [];
  if (!(dep.length === 1 && dep[0].version_id === LIVE_VERSION && dep[0].percentage === 100)) p.push(`the deployment is not exactly the live version ${LIVE_VERSION.slice(0, 8)} at 100% (found: ${dep.map((x) => `${x.version_id.slice(0, 8)} ${x.percentage}%`).join(", ") || "none"})`);
  if (dep.some((x) => x.version_id === versionId)) p.push("the uploaded version is part of the deployment: it must serve 0% until promotion");
  return p;
}

const parse = (r, what) => {
  if (r.status !== 0) throw new Error(`${what} failed (exit ${r.status})`);
  const t = String(r.stdout);
  const i = Math.min(...["{", "["].map((c) => t.indexOf(c)).filter((x) => x >= 0));
  return JSON.parse(t.slice(i));
};

export async function run({ argv, wrangler, out }) {
  const arg = argv.find((a) => a.startsWith("--version="));
  const bad = argv.filter((a) => !a.startsWith("--version="));
  const id = arg?.slice("--version=".length) ?? "";
  if (bad.length || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) { out("usage: verify-frontend-upload.mjs --version=<uuid of the uploaded version>"); return 2; }
  try {
    const view = (v) => parse(wrangler(["versions", "view", v, "--env", "production", "--json"]), `versions view ${v.slice(0, 8)}`);
    const deployment = parse(wrangler(["deployments", "status", "--env", "production", "--json"]), "deployments status");
    const problems = checkUpload({ live: view(LIVE_VERSION), p4: view(P4_VERSION), up: view(id), deployment, versionId: id });
    for (const x of problems) out(`FAIL  ${x}`);
    out(problems.length ? `\nREFUSED: ${problems.length} problem(s). Do not test or promote this version.` : `All read-only checks passed: ${id.slice(0, 8)} = the P-4 version (4 new secrets kept, no secret lost) + OTP_WORKER; live ${LIVE_VERSION.slice(0, 8)} still alone at 100%.`);
    return problems.length ? 1 : 0;
  } catch (e) {
    out(`FAIL  could not complete: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const wranglerJs = path.join(FRONTEND, "node_modules", "wrangler", "bin", "wrangler.js");
  const wrangler = (args) => spawnSync(process.execPath, [wranglerJs, ...args], { cwd: FRONTEND, encoding: "utf8", shell: false, env: safeWranglerEnv(process.env), maxBuffer: 32 * 1024 * 1024 });
  run({ argv: process.argv.slice(2), wrangler, out: (s) => console.log(s) }).then((c) => { process.exitCode = c; }, () => { process.exitCode = 1; });
}
