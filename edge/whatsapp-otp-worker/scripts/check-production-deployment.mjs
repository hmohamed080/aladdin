#!/usr/bin/env node
// READ-ONLY post-deploy check for the PRIVATE Production WhatsApp OTP Worker (P-6 of docs/operations/WHATSAPP_OTP_PRODUCTION_ROLLOUT_CHECKLIST.md).
// It REPLACES worker-preflight.mjs for Production: that script needs a public Worker URL and assumes allowlist mode, while this Worker has no
// public address and runs recipient mode "allowlist" (one secret-bound recipient). Nothing here sends, writes, deploys, rolls back, tails or changes anything:
//
//   node edge/whatsapp-otp-worker/scripts/check-production-deployment.mjs
//
// Checks (any failure exits 1 with the reasons):
//   1. DEPLOYMENT      `wrangler deployments status --name aladdin-whatsapp-otp-production --json`: exactly one version at 100%.
//   2. CONFIGURATION   `wrangler versions view <that version> --json`: the deployed bindings are EXACTLY what wrangler.production.jsonc declares
//                      (D1, the six Secrets Store secrets incl. the single-recipient allowlist, the APP_NOTIFY service binding, the plain variables, nothing extra), and the
//                      safety variables read WHATSAPP_DELIVERY_ENABLED="false", OTP_RECIPIENT_MODE="allowlist", OTP_ENVIRONMENT="production".
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
  const shape = (b) => `type=${b.type ?? "?"}, fields=${Object.keys(b).filter((k) => k !== "text" && k !== "json").sort().join("/")}`;
  for (const [name, want] of Object.entries(expected)) {
    const b = got.get(name);
    if (!b) { p.push(`binding ${name} is MISSING on the deployed version`); continue; }
    // Exact type and exact structured fields: no substring matching, so a wrong type or a value in the wrong field cannot pass.
    if (want.kind === "var") {
      if (b.type !== "plain_text" || b.text !== want.text) p.push(`variable ${name} differs from wrangler.production.jsonc (${shape(b)})`);
    } else if (want.kind === "service") {
      if (b.type !== "service" || b.service !== want.service || (b.environment !== undefined && b.environment !== "production")) {
        p.push(`service binding ${name} must be type=service to ${want.service} (production); found ${shape(b)}, service=${b.service ?? "?"}, environment=${b.environment ?? "(none)"}`);
      }
    } else if (want.kind === "secret") {
      if (b.type !== "secrets_store_secret" || b.store_id !== want.store_id || b.secret_name !== want.secret_name) {
        p.push(`secret binding ${name} must be type=secrets_store_secret with store ${want.store_id} and secret ${want.secret_name}; found ${shape(b)}, secret_name=${b.secret_name ?? "?"}`);
      }
    } else if (want.kind === "d1") {
      // The Workers API names the field `database_id` (required); `id` is an optional extra and, if present, must not disagree.
      if (b.type !== "d1" || b.database_id !== want.id || (b.id !== undefined && b.id !== want.id)) p.push(`D1 binding ${name} must be type=d1 with database_id ${want.id}; found ${shape(b)}`);
    }
  }
  for (const name of got.keys()) if (!(name in expected)) p.push(`unexpected binding ${name} on the deployed version`);
  const v = (n) => got.get(n)?.text;
  if (v("WHATSAPP_DELIVERY_ENABLED") !== "false") p.push('WHATSAPP_DELIVERY_ENABLED is not "false" on the deployed version');
  if (v("OTP_RECIPIENT_MODE") !== "allowlist") p.push('OTP_RECIPIENT_MODE is not "allowlist" on the deployed version');
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

/** Cloudflare API evidence that the Worker has no public address. subdomain = GET .../scripts/<name>/subdomain, domains = GET .../workers/domains?service=<name>,
 *  zones = [{ name, routes: GET /zones/<id>/workers/routes result }] for EVERY zone of the account. */
export function checkPrivacy({ subdomain, domains, zones }) {
  const p = [];
  if (subdomain?.enabled !== false) p.push(`workers.dev is not disabled (enabled=${subdomain?.enabled})`);
  if (subdomain?.previews_enabled !== false) p.push(`preview URLs are not disabled (previews_enabled=${subdomain?.previews_enabled})`);
  for (const d of domains ?? []) if (d?.service === WORKER || d?.service === undefined) p.push(`custom domain attached: ${d?.hostname ?? "?"}`);
  for (const z of zones ?? []) for (const r of z.routes ?? []) if (r?.script === WORKER) p.push(`route ${r.pattern} on zone ${z.name} points at this Worker`);
  if (!Array.isArray(zones)) p.push("zone routes could not be listed");
  return p;
}

/** schedules = GET .../scripts/<name>/schedules result; must equal triggers.crons of the config exactly. */
export function checkSchedules(schedules, config) {
  const got = (schedules?.schedules ?? []).map((s) => s.cron).sort();
  const want = [...(config.triggers?.crons ?? [])].sort();
  return JSON.stringify(got) === JSON.stringify(want) && want.length ? [] : [`registered cron triggers [${got.join(", ")}] differ from wrangler.production.jsonc [${want.join(", ")}]`];
}

/** res = { status, contentType, body } of an unauthenticated GET. SUPPLEMENTARY only: a GET that fails to reach the Worker proves nothing about routing. */
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

/** Reads the privacy and cron evidence from the Cloudflare API (GET only). api(path) resolves to the response's `result`. */
/** Follows result_info to the LAST page and checks the item count against total_count; anything partial throws (a partial list must never read as "private").
 *  api(path) resolves to the whole response body { result, result_info }. The first request is sent as given; later pages add &page=N. */
export async function listAll(api, path, { requireInfo = false } = {}) {
  const items = [];
  for (let page = 1; page <= 500; page += 1) {
    const r = await api(page === 1 ? path : `${path}${path.includes("?") ? "&" : "?"}page=${page}`);
    if (!Array.isArray(r?.result)) throw new Error(`${path.split("?")[0]}: the response has no result list`);
    items.push(...r.result);
    const info = r.result_info;
    if (!info) {
      if (requireInfo) throw new Error(`${path.split("?")[0]}: no result_info, completeness cannot be proven`);
      return items;
    }
    const pages = info.total_pages ?? (info.per_page ? Math.ceil(info.total_count / info.per_page) : undefined);
    if (typeof pages !== "number" || Number.isNaN(pages)) throw new Error(`${path.split("?")[0]}: result_info has no page count`);
    if (page >= pages) {
      if (info.total_count !== undefined && items.length !== info.total_count) throw new Error(`${path.split("?")[0]}: collected ${items.length} of ${info.total_count} items (partial)`);
      return items;
    }
  }
  throw new Error(`${path.split("?")[0]}: too many pages`);
}

export async function collectApiEvidence(api, accountId) {
  const base = `/accounts/${accountId}/workers`;
  const subdomain = (await api(`${base}/scripts/${WORKER}/subdomain`)).result;
  const schedules = (await api(`${base}/scripts/${WORKER}/schedules`)).result;
  const domains = await listAll(api, `${base}/domains?service=${WORKER}`);
  const zoneList = await listAll(api, `/zones?account.id=${accountId}&per_page=50`, { requireInfo: true });
  const zones = [];
  for (const z of zoneList) zones.push({ name: z.name, routes: await listAll(api, `/zones/${z.id}/workers/routes`) });
  return { subdomain, schedules, domains, zones };
}

export async function run({ argv, wrangler, get, api, accountId, out, config }) {
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

    if (!api || !accountId) {
      step("Cloudflare API evidence (workers.dev, previews, domains, routes, cron)", ["CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set (read-only token: Workers Scripts Read, Account Zone Read, Workers Routes Read); HTTP probes alone are not evidence"]);
    } else {
      const ev = await collectApiEvidence(api, accountId);
      step("private by Cloudflare API: workers.dev and preview URLs off, no custom domains, no routes", checkPrivacy(ev));
      step("cron trigger registered as declared", checkSchedules(ev.schedules, config));
    }

    const routing = [];
    for (const [label, url] of [["workers.dev address", `https://${WORKER}.${WORKERS_DEV_SUBDOMAIN}.workers.dev/`], ["Production site path", `${SITE}/v1/otp/send`]]) {
      let res;
      try { res = await get(url); } catch (e) { routing.push(`${label}: could not be probed (${e.message})`); continue; }
      if (reachedWorker(res)) routing.push(`${label} ANSWERS LIKE THE WORKER (status ${res.status}): the Worker is reachable from outside`);
    }
    step("supplementary HTTP probes (not sufficient evidence on their own)", routing);
  } catch (e) {
    out(`FAIL  could not complete: ${e.message}`);
    return 1;
  }
  out(problems.length ? `\nREFUSED: ${problems.length} problem(s). Do not continue to P-7.` : "\nAll read-only checks passed: the Worker is deployed, private, configured as declared, and has never been switched on. Delivery is OFF.");
  return problems.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cwd = path.join(HERE, "..");
  // No shell: node runs the pinned wrangler entry point directly, so every argument (the D1 SQL has spaces and parentheses) reaches wrangler verbatim on Windows too.
  const wranglerJs = path.join(cwd, "node_modules", "wrangler", "bin", "wrangler.js");
  const wrangler = (args) => spawnSync(process.execPath, [wranglerJs, ...args], { cwd, encoding: "utf8", shell: false, maxBuffer: 32 * 1024 * 1024 });
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const api = token && accountId ? async (p) => {
    const r = await fetch(`https://api.cloudflare.com/client/v4${p}`, { method: "GET", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(`Cloudflare API GET ${p.split("?")[0]} failed (HTTP ${r.status}; token needs read access)`);
    return j;
  } : null;
  const get = async (url) => {
    const r = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(20000) });
    return { status: r.status, contentType: r.headers.get("content-type") ?? "", body: (await r.text()).slice(0, 200) };
  };
  run({ argv: process.argv.slice(2), wrangler, get, api, accountId, out: (s) => console.log(s), config: parseJsonc(readFileSync(CONFIG, "utf8")) })
    .then((code) => { process.exitCode = code; }, () => { process.exitCode = 1; });
}
