#!/usr/bin/env node
// READ-ONLY post-deploy check for the PRIVATE Production WhatsApp OTP Worker (P-6 of docs/operations/WHATSAPP_OTP_PRODUCTION_ROLLOUT_CHECKLIST.md).
// It REPLACES worker-preflight.mjs for Production: that script needs a public Worker URL and assumes allowlist mode, while this Worker has no
// public address and runs recipient mode "open". Nothing here sends, writes, deploys, rolls back, tails or changes anything:
//
//   node edge/whatsapp-otp-worker/scripts/check-production-deployment.mjs
//
// Checks (any failure exits 1 with the reasons):
//   1. DEPLOYMENT      `wrangler deployments status --name aladdin-whatsapp-otp-production --json`: exactly one version at 100%.
//   2. CONFIGURATION   `wrangler versions view <that version> --json`: the deployed bindings are EXACTLY what wrangler.production.jsonc declares
//                      (D1, the five Secrets Store secrets, the APP_NOTIFY service binding, the plain variables, nothing extra), and the
//                      safety variables read WHATSAPP_DELIVERY_ENABLED="false", OTP_RECIPIENT_MODE="open", OTP_ENVIRONMENT="production".
//                      The config file itself must have workers_dev=false and no routes.
//   3. D1 SWITCH       one SELECT: otp_delivery_switch, otp_delivery_audit and otp_delivery_attestation are EMPTY (delivery has never been
//                      switched on, so nothing can send) and otp_alert_state has its single seed row.
//   4. PRIVATE ROUTING two unauthenticated GETs that must NOT reach the Worker (the Worker answers any GET with a JSON 404 whose body is {}):
//                      its workers.dev address and a path on the Production site. A response with that fingerprint, or any 2xx, fails.
//
// What this does NOT check, by design: an AUTHENTICATED runtime probe. A private Worker is only reachable through the frontend's OTP_WORKER
// service binding, so that probe runs after the frontend upload (checklist step P-7a) through the Admin page "Sending service" panel.
// Exit codes: 0 all checks passed, 1 a check failed or could not be completed, 2 usage.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

export const WORKER = "aladdin-whatsapp-otp-production";
export const D1_NAME = "aladdin-whatsapp-otp-production";
export const WORKERS_DEV_SUBDOMAIN = "bstalent9"; // the account's workers.dev subdomain (the preview Worker lives at aladdin-whatsapp-otp-preview.bstalent9.workers.dev)
export const SITE = "https://aladdindecore.com";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.join(HERE, "..", "wrangler.production.jsonc");

export const SWITCH_SQL =
  "select (select count(*) from otp_delivery_switch) as sw, (select count(*) from otp_delivery_audit) as au, " +
  "(select count(*) from otp_delivery_attestation) as att, (select count(*) from otp_alert_state) as al";

export function parseJsonc(text) {
  let out = "";
  let inStr = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inStr) { out += c; if (c === "\\") { out += text[i + 1]; i += 1; } else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i += 1; out += "\n"; continue; }
    if (c === "/" && text[i + 1] === "*") { i += 2; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1; i += 1; continue; }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** What wrangler.production.jsonc says the deployed Worker must have, as { name: { kind, ... } }. */
export function expectedBindings(config) {
  const e = {};
  for (const d of config.d1_databases ?? []) e[d.binding] = { kind: "d1", id: d.database_id };
  for (const s of config.secrets_store_secrets ?? []) e[s.binding] = { kind: "secret", store_id: s.store_id, secret_name: s.secret_name };
  for (const s of config.services ?? []) e[s.binding] = { kind: "service", service: s.service };
  for (const [k, v] of Object.entries(config.vars ?? {})) e[k] = { kind: "var", text: String(v) };
  return e;
}

export function checkConfigFile(config) {
  const p = [];
  if (config.workers_dev !== false) p.push("wrangler.production.jsonc: workers_dev must be false (the Worker must have no public address)");
  if ((config.routes ?? []).length) p.push("wrangler.production.jsonc: routes must be empty");
  if (config.vars?.WHATSAPP_DELIVERY_ENABLED !== "false") p.push('wrangler.production.jsonc: WHATSAPP_DELIVERY_ENABLED must be "false"');
  return p;
}

export function checkDeployment(status) {
  const v = status?.versions ?? [];
  if (v.length !== 1 || v[0].percentage !== 100) {
    return { problems: [`the deployment is not exactly one version at 100% (found: ${v.map((x) => `${x.version_id} ${x.percentage}%`).join(", ") || "none"})`], versionId: null };
  }
  return { problems: [], versionId: v[0].version_id };
}

/** view = `versions view --json`. Compares the deployed bindings with the declared ones; never prints a value except the safety variables. */
export function checkBindings(view, expected) {
  const p = [];
  const got = new Map((view?.resources?.bindings ?? []).map((b) => [b.name, b]));
  const text = (b) => JSON.stringify(b);
  for (const [name, want] of Object.entries(expected)) {
    const b = got.get(name);
    if (!b) { p.push(`binding ${name} is MISSING on the deployed version`); continue; }
    if (want.kind === "var") {
      if (b.type !== "plain_text" || String(b.text) !== want.text) p.push(`variable ${name} differs from wrangler.production.jsonc`);
    } else if (want.kind === "service") {
      if (b.service !== want.service) p.push(`service binding ${name} points at ${b.service ?? "?"}, expected ${want.service}`);
    } else if (want.kind === "secret") {
      if (!text(b).includes(want.secret_name) || !text(b).includes(want.store_id)) p.push(`secret binding ${name} does not reference ${want.secret_name}`);
    } else if (want.kind === "d1") {
      if (!text(b).includes(want.id)) p.push(`D1 binding ${name} does not reference the Production database`);
    }
  }
  for (const name of got.keys()) if (!(name in expected)) p.push(`unexpected binding ${name} on the deployed version`);
  const v = (n) => got.get(n)?.text;
  if (v("WHATSAPP_DELIVERY_ENABLED") !== "false") p.push('WHATSAPP_DELIVERY_ENABLED is not "false" on the deployed version');
  if (v("OTP_RECIPIENT_MODE") !== "open") p.push('OTP_RECIPIENT_MODE is not "open" on the deployed version');
  if (v("OTP_ENVIRONMENT") !== "production") p.push('OTP_ENVIRONMENT is not "production" on the deployed version');
  return p;
}

/** d1 = `d1 execute --json` output for SWITCH_SQL. */
export function checkSwitch(d1) {
  const row = d1?.[0]?.results?.[0];
  if (!row) return ["the D1 query returned no row"];
  const p = [];
  for (const [k, label] of [["sw", "otp_delivery_switch"], ["au", "otp_delivery_audit"], ["att", "otp_delivery_attestation"]]) {
    if (Number(row[k]) !== 0) p.push(`${label} has ${row[k]} row(s): delivery has been switched or tampered with; it must be empty before activation`);
  }
  if (Number(row.al) !== 1) p.push(`otp_alert_state has ${row.al} row(s), expected the single seed row`);
  return p;
}

/** res = { status, contentType, body } of an unauthenticated GET. */
export function reachedWorker(res) {
  if (!res) return false;
  const json = /application\/json/i.test(res.contentType ?? "");
  return (res.status >= 200 && res.status < 300) || (json && String(res.body ?? "").trim() === "{}");
}

const parse = (r, what) => {
  if (r.status !== 0) throw new Error(`${what} failed (exit ${r.status})`);
  const t = String(r.stdout);
  const starts = ["{", "["].map((c) => t.indexOf(c)).filter((i) => i >= 0);
  if (!starts.length) throw new Error(`${what} returned no JSON`);
  return JSON.parse(t.slice(Math.min(...starts)));
};

export async function run({ argv, wrangler, get, out, config }) {
  if (argv.length) { out(`unexpected argument: ${argv[0]}`); return 2; }
  const problems = [];
  const step = (label, list) => { out(`${list.length ? "FAIL" : "ok  "}  ${label}`); for (const x of list) { out(`        - ${x}`); problems.push(`${label}: ${x}`); } };
  try {
    step("configuration file (private, delivery false)", checkConfigFile(config));

    const status = parse(wrangler(["deployments", "status", "--name", WORKER, "--json"]), "deployments status");
    const dep = checkDeployment(status);
    step("deployment (one version at 100%)", dep.problems);

    if (dep.versionId) {
      const view = parse(wrangler(["versions", "view", dep.versionId, "--name", WORKER, "--json"]), "versions view");
      step("deployed configuration equals wrangler.production.jsonc; safety variables", checkBindings(view, expectedBindings(config)));
    }

    const d1 = parse(wrangler(["d1", "execute", D1_NAME, "--remote", "-c", "wrangler.production.jsonc", "--json", "--command", SWITCH_SQL]), "d1 execute");
    step("D1 switch tables empty (delivery never switched on)", checkSwitch(d1));

    const routing = [];
    for (const [label, url] of [["workers.dev address", `https://${WORKER}.${WORKERS_DEV_SUBDOMAIN}.workers.dev/`], ["Production site path", `${SITE}/v1/otp/send`]]) {
      let res;
      try { res = await get(url); } catch (e) { routing.push(`${label}: could not be probed (${e.message})`); continue; }
      if (reachedWorker(res)) routing.push(`${label} ANSWERS LIKE THE WORKER (status ${res.status}): the Worker is reachable from outside`);
    }
    step("private routing (no public address)", routing);
  } catch (e) {
    out(`FAIL  could not complete: ${e.message}`);
    return 1;
  }
  out(problems.length ? `\nREFUSED: ${problems.length} problem(s). Do not continue to P-7.` : "\nAll read-only checks passed: the Worker is deployed, private, configured as declared, and has never been switched on. Delivery is OFF.");
  return problems.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cwd = path.join(HERE, "..");
  const wrangler = (args) => spawnSync("pnpm", ["exec", "wrangler", ...args], { cwd, encoding: "utf8", shell: process.platform === "win32", maxBuffer: 32 * 1024 * 1024 });
  const get = async (url) => {
    const r = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(20000) });
    return { status: r.status, contentType: r.headers.get("content-type") ?? "", body: (await r.text()).slice(0, 200) };
  };
  run({ argv: process.argv.slice(2), wrangler, get, out: (s) => console.log(s), config: parseJsonc(readFileSync(CONFIG, "utf8")) })
    .then((code) => { process.exitCode = code; }, () => { process.exitCode = 1; });
}
