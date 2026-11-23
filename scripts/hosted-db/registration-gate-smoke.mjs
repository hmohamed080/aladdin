#!/usr/bin/env node
/**
 * Post-apply refusal smoke test for the registration gate (ADR-0031, plan "registration-gate"). Run by the OWNER after the plan is applied
 * to Acceptance. It proves, against the live Data API, that an account whose registration is UNFINISHED is refused state-changing
 * requests (HTTP 403, hint registration_incomplete), that reads still work, and (optionally) that a FINISHED account is not affected.
 *
 * HARMLESS BY DESIGN. Every write probe targets a row that cannot exist (a random uuid) or a function that fails on its own input, so if
 * the gate were NOT active nothing is created or changed: the request would simply match no rows / fail validation, and this script
 * reports that as FAIL. It never creates an organization, a profile, an upload or any other record.
 *
 * Usage (PowerShell; the password is read from the environment, never from the command line history):
 *   $env:SMOKE_URL = "https://nxossqhdfltcqdwvbewi.supabase.co"
 *   $env:SMOKE_PUBLISHABLE_KEY = "<the Acceptance publishable key>"
 *   $env:SMOKE_EMAIL = "<an account that has NOT finished registration>"; $env:SMOKE_PASSWORD = "<its password>"
 *   # optional, a finished account:  $env:SMOKE_DONE_EMAIL / $env:SMOKE_DONE_PASSWORD
 * Acceptance has hosted CAPTCHA protection ON, so a token-less password grant is refused (captcha_failed). In that case do NOT turn the
 * protection off: sign in through the app's own page instead, copy that session's access token (browser dev tools, Application, the
 * sb-...-auth-token cookie/storage, field access_token) and pass it as SMOKE_ACCESS_TOKEN (and SMOKE_DONE_ACCESS_TOKEN for the optional
 * finished account) in place of the email and password. Access tokens expire after about an hour.
 *   node scripts/hosted-db/registration-gate-smoke.mjs
 * Only the Acceptance project is accepted; Production is refused. Needs no database password and no service key.
 */
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export const ACCEPTANCE_REF = "nxossqhdfltcqdwvbewi";
const UNFINISHED = new Set(["consent_pending", "account_type_pending"]);
const FINISHED = new Set(["access_ready", "active_personal"]);

export function projectRef(url) {
  try { return new URL(url).hostname.split(".")[0]; } catch { return ""; }
}

async function signIn(fetchImpl, url, key, email, password) {
  const r = await fetchImpl(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: key, "content-type": "application/json" }, body: JSON.stringify({ email, password }),
  });
  const body = await r.json().catch(() => ({}));
  if (!body?.access_token) throw new Error(`sign-in failed (HTTP ${r.status})`);
  return body.access_token;
}

async function call(fetchImpl, url, key, token, method, path, body, headers = {}) {
  const r = await fetchImpl(`${url}/rest/v1${path}`, {
    method, headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: r.status, json, gate: r.status === 403 && json?.hint === "registration_incomplete" };
}

/** @returns {Promise<{ok: boolean, lines: string[]}>} */
export async function runSmoke({ fetchImpl = fetch, env = process.env } = {}) {
  const lines = []; let ok = true;
  const out = (pass, text) => { lines.push(`${pass ? "PASS" : "FAIL"}  ${text}`); if (!pass) ok = false; };
  const url = (env.SMOKE_URL ?? "").replace(/\/+$/, ""), key = env.SMOKE_PUBLISHABLE_KEY ?? "";
  if (!url || !key || !(env.SMOKE_ACCESS_TOKEN || (env.SMOKE_EMAIL && env.SMOKE_PASSWORD))) return { ok: false, lines: ["FAIL  set SMOKE_URL, SMOKE_PUBLISHABLE_KEY and either SMOKE_ACCESS_TOKEN or SMOKE_EMAIL + SMOKE_PASSWORD (see the header of this file)"] };
  if (projectRef(url) !== ACCEPTANCE_REF) return { ok: false, lines: [`FAIL  refused: ${url} is not the Acceptance project (${ACCEPTANCE_REF}); this script never runs against Production or any other project`] };
  if (key.startsWith("sb_secret_") || key.includes("service_role")) return { ok: false, lines: ["FAIL  refused: pass the PUBLISHABLE key, never a secret/service key"] };

  // ---- unfinished account: writes refused, reads allowed
  const token = env.SMOKE_ACCESS_TOKEN || await signIn(fetchImpl, url, key, env.SMOKE_EMAIL, env.SMOKE_PASSWORD);
  const state = await call(fetchImpl, url, key, token, "POST", "/rpc/my_registration_state", {});
  const s = typeof state.json === "string" ? state.json : "";
  if (state.status !== 200 || !UNFINISHED.has(s)) {
    return { ok: false, lines: [`FAIL  the SMOKE_EMAIL/SMOKE_ACCESS_TOKEN account must be mid-registration (consent_pending or account_type_pending); it reports "${s || state.status}". Use an account that has signed up but not finished.`] };
  }
  out(true, `account is mid-registration (${s})`);
  const nobody = randomUUID();
  const probes = [
    ["a table UPDATE (matches no row)", () => call(fetchImpl, url, key, token, "PATCH", `/profiles?user_id=eq.${nobody}`, { headline: "gate-smoke" }, { prefer: "return=minimal" })],
    ["a table DELETE (matches no row)", () => call(fetchImpl, url, key, token, "DELETE", `/user_availability_windows?id=eq.${nobody}`)],
    ["a table INSERT that fails on its own input", () => call(fetchImpl, url, key, token, "POST", "/organizations", {})],
    ["a state-changing RPC with an unknown target", () => call(fetchImpl, url, key, token, "POST", "/rpc/job_save", { p_job_id: nobody })],
    ["the graphql_public schema (a query, not a mutation)", () => call(fetchImpl, url, key, token, "POST", "/rpc/graphql", { query: "{ __typename }" }, { "content-profile": "graphql_public" })],
  ];
  for (const [label, run] of probes) {
    const r = await run();
    out(r.gate, `${label} is refused by the gate (HTTP ${r.status}${r.gate ? "" : ` ${JSON.stringify(r.json)?.slice(0, 80)}`})`);
  }
  const read = await call(fetchImpl, url, key, token, "GET", `/profiles?select=user_id&limit=1`);
  out(read.status === 200, `a read still works (HTTP ${read.status})`);
  for (const step of ["my_registration_state", "my_account_status"]) {
    const r = await call(fetchImpl, url, key, token, "POST", `/rpc/${step}`, {});
    out(r.status === 200 && !r.gate, `${step} still works (HTTP ${r.status})`);
  }

  // ---- optional finished account: not affected
  if (env.SMOKE_DONE_ACCESS_TOKEN || (env.SMOKE_DONE_EMAIL && env.SMOKE_DONE_PASSWORD)) {
    const t2 = env.SMOKE_DONE_ACCESS_TOKEN || await signIn(fetchImpl, url, key, env.SMOKE_DONE_EMAIL, env.SMOKE_DONE_PASSWORD);
    const st2 = await call(fetchImpl, url, key, t2, "POST", "/rpc/my_registration_state", {});
    const s2 = typeof st2.json === "string" ? st2.json : "";
    if (!FINISHED.has(s2)) out(false, `the SMOKE_DONE_EMAIL/SMOKE_DONE_ACCESS_TOKEN account must have finished registration; it reports "${s2 || st2.status}"`);
    else {
      out(true, `second account is registered (${s2})`);
      const w = await call(fetchImpl, url, key, t2, "PATCH", `/profiles?user_id=eq.${nobody}`, { headline: "gate-smoke" }, { prefer: "return=minimal" });
      out(!w.gate && w.status < 300, `a finished account's write is NOT refused by the gate (HTTP ${w.status}, matches no row)`);
    }
  }
  lines.push(ok ? "\nREGISTRATION GATE SMOKE: OK" : "\nREGISTRATION GATE SMOKE: FAILED - do not continue; roll back with the pinned forward-fix only on the owner's GO");
  return { ok, lines };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSmoke().then(({ ok, lines }) => { console.log(lines.join("\n")); process.exit(ok ? 0 : 1); })
    .catch((e) => { console.error(`FAIL  ${e.message}`); process.exit(1); });
}
