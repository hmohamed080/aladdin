#!/usr/bin/env node
// READ-ONLY verification of the Production frontend version uploaded by `cloudflare-production` stage=frontend-upload (checklist P-7).
// It never uploads, deploys, rolls back, writes a secret or sends anything: only `deployments status` and `versions view`.
//
//   node scripts/hosted-db/verify-frontend-upload.mjs --version=<uploaded version id> --expect-sha=<40 hex>
//
// --expect-sha (REQUIRED: without it any older version with the same bindings would pass): the workflow uploads with `--message "upload-only ${GITHUB_SHA::12}"`, stored as the version annotation `workers/message`.
// With the flag, that annotation must equal `upload-only <first 12 hex of the SHA>`. This is a label written by the workflow, not a build
// attestation: it proves which commit the dispatched run was on, not the bytes of the bundle (cross-check the run summary and run's head SHA).
//
// The uploaded version U must equal the P-4 version (live bindings + the four PHONE_OTP_* secrets) PLUS the five phone SIGN-UP secrets
// (SIGNUP_SECRET_NAMES, all secret_text; created by provision-frontend-signup-secrets.mjs) PLUS exactly one new binding:
// the private service binding OTP_WORKER -> aladdin-whatsapp-otp-production. Checked by NAME and TYPE (secret values are never visible):
//   - secret_text names of U == those of the P-4 version + the 5 sign-up secrets (nothing lost, nothing extra, none missing)
//   - plain_text names of U == those of the live version, with identical public values (values are never printed)
//   - service / assets / images / version_metadata bindings of the live version unchanged; OTP_WORKER added, targeting production
//   - no PHONE_* or WHATSAPP_* switch among the plain variables (the feature stays OFF)
//   - the live version is still alone at 100% and U is NOT part of the deployment
// Exit 0 = all checks passed, 1 = a check failed or could not be completed, 2 = usage.
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { LIVE_VERSION, NEW_NAMES, P4_VERSION, SIGNUP_SECRET_NAMES, safeWranglerEnv } from "./provision-frontend-otp-secrets.mjs";

export { P4_VERSION };
export const OTP_WORKER_TARGET = "aladdin-whatsapp-otp-production";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.join(HERE, "..", "..", "frontend");

const byName = (v) => new Map((v?.resources?.bindings ?? []).map((b) => [b.name, b]));
const names = (m, type) => [...m.values()].filter((b) => b.type === type).map((b) => b.name).sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** live / p4 / up = `versions view --json` of the live version, the P-4 version and the uploaded version. */
export const expectedMessage = (sha) => `upload-only ${sha.slice(0, 12)}`;
export function checkUpload({ live, p4, up, deployment, versionId, expectSha }) {
  const p = [];
  if (expectSha !== undefined) {
    const m = up?.annotations?.["workers/message"];
    if (typeof m !== "string") p.push("--expect-sha given but the uploaded version has no workers/message annotation (cannot prove its source commit)");
    else if (m !== expectedMessage(expectSha)) p.push(`source commit mismatch: version message is "${m}", expected "${expectedMessage(expectSha)}"`);
  }
  const L = byName(live), P = byName(p4), U = byName(up);
  if (!U.size) return ["the uploaded version has no bindings (wrong version id?)"];
  if (versionId === LIVE_VERSION || versionId === P4_VERSION) p.push("the version to verify is the live or the P-4 version, not a new upload");

  const upSecrets = names(U, "secret_text"), p4Secrets = names(P, "secret_text");
  const expectedSecrets = [...new Set([...p4Secrets, ...SIGNUP_SECRET_NAMES])].sort();
  for (const n of expectedSecrets) if (!U.has(n)) p.push(`secret ${n} is MISSING on the uploaded version`);
  for (const n of upSecrets) if (!expectedSecrets.includes(n)) p.push(`unexpected secret ${n} on the uploaded version`);
  for (const n of [...NEW_NAMES, ...SIGNUP_SECRET_NAMES]) if (U.get(n)?.type !== "secret_text") p.push(`${n} must be a secret_text binding on the uploaded version`);
  for (const n of ["AUTH_PASSWORD_PREVIEW_GRANT_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "TURNSTILE_SECRET_KEY", "RESEND_API_KEY"]) if (U.get(n)?.type !== "secret_text") p.push(`existing secret ${n} must still be secret_text`);
  if (!same(upSecrets, expectedSecrets)) p.push(`secret names differ from the expected set P-4 + 5 sign-up secrets (uploaded: ${upSecrets.length}, expected: ${expectedSecrets.length})`);

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
  const added = [...U.keys()].filter((n) => !L.has(n) && !P.has(n) && !SIGNUP_SECRET_NAMES.includes(n)).sort();
  if (!same(added, ["OTP_WORKER"])) p.push(`new bindings beyond the live and P-4 versions are [${added.join(", ")}], expected exactly [OTP_WORKER]`);

  const dep = deployment?.versions ?? [];
  if (!(dep.length === 1 && dep[0].version_id === LIVE_VERSION && dep[0].percentage === 100)) p.push(`the deployment is not exactly the live version ${LIVE_VERSION.slice(0, 8)} at 100% (found: ${dep.map((x) => `${x.version_id.slice(0, 8)} ${x.percentage}%`).join(", ") || "none"})`);
  if (dep.some((x) => x.version_id === versionId)) p.push("the uploaded version is part of the deployment: it must serve 0% until promotion");
  return p;
}

// wrangler may print banner/log lines (even ones containing "[") before the JSON: try each line that starts a JSON value.
export const parse = (r, what) => {
  if (r.status !== 0) throw new Error(`${what} failed (exit ${r.status})`);
  const t = String(r.stdout).replace(/^﻿/, "");
  for (const m of t.matchAll(/^[\t ]*[{[]/gm)) {
    try { return JSON.parse(t.slice(m.index)); } catch { /* not the JSON start, keep looking */ }
  }
  throw new Error(`${what}: no JSON in the wrangler output`);
};

export async function run({ argv, wrangler, out }) {
  const arg = argv.find((a) => a.startsWith("--version="));
  const shaArg = argv.find((a) => a.startsWith("--expect-sha="));
  const bad = argv.filter((a) => !a.startsWith("--version=") && !a.startsWith("--expect-sha="));
  const id = arg?.slice("--version=".length) ?? "";
  const expectSha = shaArg?.slice("--expect-sha=".length);
  if (bad.length || argv.filter((a) => a.startsWith("--expect-sha=")).length > 1 || expectSha === undefined || !/^[0-9a-f]{40}$/.test(expectSha) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) { out("usage: verify-frontend-upload.mjs --version=<uuid of the uploaded version> --expect-sha=<40 lowercase hex, REQUIRED>"); return 2; }
  try {
    const view = (v) => parse(wrangler(["versions", "view", v, "--env", "production", "--json"]), `versions view ${v.slice(0, 8)}`);
    const deployment = parse(wrangler(["deployments", "status", "--env", "production", "--json"]), "deployments status");
    const problems = checkUpload({ live: view(LIVE_VERSION), p4: view(P4_VERSION), up: view(id), deployment, versionId: id, expectSha });
    for (const x of problems) out(`FAIL  ${x}`);
    out(problems.length ? `\nREFUSED: ${problems.length} problem(s). Do not test or promote this version.` : `All read-only checks passed: ${id.slice(0, 8)} = the P-4 version (4 OTP secrets kept) + the 5 sign-up secrets + OTP_WORKER, no secret lost or extra; live ${LIVE_VERSION.slice(0, 8)} still alone at 100%. Source label matches ${expectSha.slice(0, 12)} (a label, not a bundle attestation).`);
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
