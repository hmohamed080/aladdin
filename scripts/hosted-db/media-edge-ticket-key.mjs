#!/usr/bin/env node
// Installs the shared media-ticket signing key on exactly two ACCEPTANCE Workers:
//   aladdin-media-edge-preview  secret TICKET_KEYS              = {"<kid>":"<base64url 32 bytes>"}
//   aladdin-frontend-preview    secret MEDIA_EDGE_TICKET_SECRET = "<the same base64url 32 bytes>"
//                               secret MEDIA_EDGE_TICKET_KID    = "<kid>"
// It does NOT enable edge delivery (MEDIA_EDGE_DELIVERY_ENABLED stays off), touch Production, DNS,
// R2 or any other Worker. The target list is fixed in this file and cannot be changed by arguments.
//
// Where the key exists, precisely:
//   - in this Node process's memory while it runs (never printed, logged, written to disk or put on
//     a command line; Node strings cannot be wiped, so it lives until the process exits);
//   - in the bodies of three HTTPS PUTs to api.cloudflare.com (TLS; the script refuses to run with
//     TLS verification disabled or NODE_OPTIONS set, and warns if extra CA certificates are trusted);
//   - in the two Workers' encrypted secrets (the API never returns secret values).
// The Cloudflare API token is read from the environment variable CF_MEDIA_KEY_TOKEN (set with
// `read -rs`, so it is not echoed or kept in shell history), removed from this process's
// environment at start, and never printed.
//
// Every secret PUT creates a new version of that Worker with the same code and deploys it at 100%
// immediately, so a full install creates 3 versions (1 media, 2 frontend). While edge delivery is
// off the app never reads these values, so users see no change. Later deploys keep the secrets.
//
// Modes (repository root; needs only Node 20+, no `pnpm install`):
//   node scripts/hosted-db/media-edge-ticket-key.mjs            checks only, changes nothing (default)
//   node scripts/hosted-db/media-edge-ticket-key.mjs --apply    checks, then installs a NEW key on both
//   node scripts/hosted-db/media-edge-ticket-key.mjs --verify   lists the secret NAMES on both Workers
//   node scripts/hosted-db/media-edge-ticket-key.mjs --remove   deletes the three secrets (recovery)
// Token: "Account > Workers Scripts > Edit" on the Aladdin account only, with an expiry within 24 h.
//   read -rsp 'Cloudflare API token: ' CF_MEDIA_KEY_TOKEN; echo; export CF_MEDIA_KEY_TOKEN
//   node scripts/hosted-db/media-edge-ticket-key.mjs --apply; unset CF_MEDIA_KEY_TOKEN

import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

export const ACCOUNT_ID = "a4c2b7ac45e58a81691b9165492ce6a2";
const ACCEPTANCE_REF = "nxossqhdfltcqdwvbewi";
const LIVE_MARKERS = /kkpkgjrweysgvhvkhzun|aladdindecore\.com/;
const ACCEPTANCE_BUCKET = "aladdin-r2-acceptance-20261011-private";
const HYPERDRIVE_ID = "163eb6ad3a4c4b89840b28983999b995";
export const MEDIA = "aladdin-media-edge-preview";
export const FRONTEND = "aladdin-frontend-preview";
const MAX_TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;
// Self-test only: a local mock of the Cloudflare API. Anything but loopback http is refused.
const API = process.env.MEDIA_EDGE_KEY_TEST_API ?? "https://api.cloudflare.com/client/v4";

/** Secret names per Worker, in install order (the media Worker first). */
export const SECRETS = { [MEDIA]: ["TICKET_KEYS"], [FRONTEND]: ["MEDIA_EDGE_TICKET_SECRET", "MEDIA_EDGE_TICKET_KID"] };

/** A new key id: `k` + UTC yyyymmddhhmm (13 chars, matches both sides' ^[a-z0-9]{1,16}$). */
export function newKid(now = new Date()) {
  return `k${now.toISOString().slice(0, 16).replace(/[-T:]/g, "")}`;
}

/** The three secret values for one key, in the formats edge/media-worker/src/ticket.ts and frontend/src/lib/env/storage.ts accept. */
export function secretValues(kid, keyBytes) {
  if (!/^[a-z0-9]{1,16}$/.test(kid) || keyBytes.length < 32) throw new Error("internal: bad key shape");
  const secret = keyBytes.toString("base64url");
  return { TICKET_KEYS: JSON.stringify({ [kid]: secret }), MEDIA_EDGE_TICKET_SECRET: secret, MEDIA_EDGE_TICKET_KID: kid };
}

function checkTransport() {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("NODE_TLS_REJECT_UNAUTHORIZED=0 disables TLS checks. Unset it and rerun.");
  if (process.env.NODE_OPTIONS) throw new Error("NODE_OPTIONS is set (it can load code into this process). Unset it for this run.");
  if (process.env.NODE_EXTRA_CA_CERTS) console.warn(`Warning: NODE_EXTRA_CA_CERTS adds trusted CAs (${process.env.NODE_EXTRA_CA_CERTS}).`);
  if (process.env.MEDIA_EDGE_KEY_TEST_API && !/^http:\/\/127\.0\.0\.1:\d+(\/|$)/.test(API)) throw new Error("MEDIA_EDGE_KEY_TEST_API must be a loopback http URL.");
}

async function api(token, method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok && json.success !== false, status: response.status, json };
}

const redact = (text, hidden) => hidden.filter(Boolean).reduce((out, h) => out.split(h).join("<hidden>"), text);
const apiErrors = (json, hidden) =>
  redact((json.errors ?? []).map((e) => `${e.code ?? ""} ${e.message ?? ""}`.trim()).join("; "), hidden) || "no detail";

/** Short-lived, one account, no R2 / Hyperdrive rights. Throws on anything else. */
async function checkToken(token) {
  let verify = await api(token, "GET", "/user/tokens/verify");
  if (!verify.ok) verify = await api(token, "GET", `/accounts/${ACCOUNT_ID}/tokens/verify`);
  if (!verify.ok) throw new Error(`The token was refused (HTTP ${verify.status}): ${apiErrors(verify.json, [token])}`);
  if (verify.json.result?.status !== "active") throw new Error("The token is not active.");
  const expires = Date.parse(verify.json.result?.expires_on ?? "");
  if (!Number.isFinite(expires)) throw new Error("The token has no expiry. Create one that expires within 24 hours.");
  if (expires - Date.now() > MAX_TOKEN_LIFETIME_MS) throw new Error("The token expires more than 24 hours from now. Create a shorter-lived one.");

  const accounts = await api(token, "GET", "/accounts?per_page=50");
  if (!accounts.ok) throw new Error(`Cannot list accounts (HTTP ${accounts.status}): ${apiErrors(accounts.json, [token])}`);
  const ids = (accounts.json.result ?? []).map((a) => a.id);
  if (ids.length !== 1 || ids[0] !== ACCOUNT_ID) throw new Error(`The token must see exactly the Aladdin account ${ACCOUNT_ID}; it sees ${ids.length} account(s).`);

  // Least privilege, checked from the outside: these must be refused.
  for (const [label, path] of [["R2", `/accounts/${ACCOUNT_ID}/r2/buckets`], ["Hyperdrive", `/accounts/${ACCOUNT_ID}/hyperdrive/configs`]]) {
    if ((await api(token, "GET", path)).ok) throw new Error(`The token can read ${label}. Use a token with only Workers Scripts: Edit.`);
  }
}

const bindingsOf = (settings) => settings.json.result?.bindings ?? [];
const text = (bindings, name) => bindings.find((b) => b.name === name && b.type === "plain_text")?.text;

/** Both Workers exist and are wired to Acceptance resources only. Throws on anything else. */
async function checkTargets(token) {
  const scripts = await api(token, "GET", `/accounts/${ACCOUNT_ID}/workers/scripts`);
  if (!scripts.ok) throw new Error(`Cannot list Workers (HTTP ${scripts.status}): ${apiErrors(scripts.json, [token])}. The token needs Workers Scripts: Edit.`);
  const names = new Set((scripts.json.result ?? []).map((s) => s.id));
  for (const name of [MEDIA, FRONTEND]) if (!names.has(name)) throw new Error(`Worker ${name} does not exist on the account. No changes were made.`);

  const settings = {};
  for (const name of [MEDIA, FRONTEND]) {
    const s = await api(token, "GET", `/accounts/${ACCOUNT_ID}/workers/scripts/${name}/settings`);
    if (!s.ok) throw new Error(`Cannot read ${name} settings (HTTP ${s.status}): ${apiErrors(s.json, [token])}`);
    if (LIVE_MARKERS.test(JSON.stringify(bindingsOf(s)))) throw new Error(`${name} references a Production resource. Stopped; no changes were made.`);
    settings[name] = bindingsOf(s);
  }

  const media = settings[MEDIA];
  const bucket = media.find((b) => b.type === "r2_bucket" && b.name === "MEDIA_BUCKET")?.bucket_name;
  const hyperdrive = media.find((b) => b.type === "hyperdrive" && b.name === "HYPERDRIVE")?.id;
  if (bucket !== ACCEPTANCE_BUCKET) throw new Error(`${MEDIA} is not bound to the Acceptance bucket. Stopped; no changes were made.`);
  if (hyperdrive !== HYPERDRIVE_ID) throw new Error(`${MEDIA} is not bound to the Acceptance Hyperdrive. Stopped; no changes were made.`);

  const front = settings[FRONTEND];
  if (text(front, "NEXT_PUBLIC_SUPABASE_URL") !== `https://${ACCEPTANCE_REF}.supabase.co`) throw new Error(`${FRONTEND} is not on the Acceptance Supabase project. Stopped; no changes were made.`);
  if (text(front, "R2_PRIVATE_BUCKET") !== ACCEPTANCE_BUCKET) throw new Error(`${FRONTEND} is not on the Acceptance R2 bucket. Stopped; no changes were made.`);
  if (text(front, "MEDIA_EDGE_DELIVERY_ENABLED") === "true") throw new Error(`${FRONTEND} already has edge delivery enabled. Turn it off before changing keys.`);
  for (const name of SECRETS[FRONTEND]) {
    if (front.some((b) => b.name === name && b.type !== "secret_text")) throw new Error(`${FRONTEND} has ${name} as a plain variable; remove it first.`);
  }
  return settings;
}

async function secretNames(token, worker) {
  const listed = await api(token, "GET", `/accounts/${ACCOUNT_ID}/workers/scripts/${worker}/secrets`);
  if (!listed.ok) throw new Error(`Cannot list ${worker} secrets (HTTP ${listed.status}): ${apiErrors(listed.json, [token])}`);
  return (listed.json.result ?? []).map((s) => s.name);
}

async function report(token) {
  let complete = true;
  for (const worker of [MEDIA, FRONTEND]) {
    const names = await secretNames(token, worker);
    for (const name of SECRETS[worker]) {
      const present = names.includes(name);
      complete &&= present;
      console.log(`  ${worker}: ${name} ${present ? "installed" : "MISSING"}`);
    }
  }
  return complete;
}

async function apply(token, rl) {
  const kid = newKid();
  const keyBytes = randomBytes(32);
  const values = secretValues(kid, keyBytes);
  keyBytes.fill(0);
  const hidden = [token, values.MEDIA_EDGE_TICKET_SECRET, values.TICKET_KEYS];
  console.log(`\nA new 256-bit key was generated in memory (key id ${kid}; the id is not secret).`);
  console.log("It will replace any existing ticket key on both Workers. Each secret change deploys a new Worker version immediately.");
  if ((await rl.question("Type install to continue, anything else to stop: ")).trim() !== "install") throw new Error("Stopped: no changes were made.");

  const done = [];
  for (const worker of [MEDIA, FRONTEND]) {
    for (const name of SECRETS[worker]) {
      const put = await api(token, "PUT", `/accounts/${ACCOUNT_ID}/workers/scripts/${worker}/secrets`, { name, text: values[name], type: "secret_text" });
      if (!put.ok) {
        const where = done.length ? `Already changed: ${done.join(", ")}.` : "Nothing was changed.";
        throw new Error(`Setting ${worker} ${name} failed (HTTP ${put.status}): ${apiErrors(put.json, hidden)}. ${where} Rerun --apply to install a fresh key on both (see README "Recovery").`);
      }
      done.push(`${worker} ${name}`);
      console.log(`  set ${worker}: ${name}`);
    }
  }
  console.log("\nVerifying (names only):");
  if (!(await report(token))) throw new Error("A secret is missing after install. Rerun --apply.");
  console.log(`\nDone. Key id ${kid} is installed on both Workers. Edge delivery is still OFF.`);
}

async function remove(token, rl) {
  console.log(`\nThis deletes ${SECRETS[MEDIA].join(", ")} from ${MEDIA} and ${SECRETS[FRONTEND].join(", ")} from ${FRONTEND}.`);
  console.log("Each delete deploys a new Worker version immediately. Private media on the edge then answers 404 (fail closed).");
  if ((await rl.question("Type remove to continue, anything else to stop: ")).trim() !== "remove") throw new Error("Stopped: no changes were made.");
  for (const worker of [FRONTEND, MEDIA]) {
    const names = await secretNames(token, worker);
    for (const name of SECRETS[worker].filter((n) => names.includes(n))) {
      const del = await api(token, "DELETE", `/accounts/${ACCOUNT_ID}/workers/scripts/${worker}/secrets/${name}`);
      if (!del.ok) throw new Error(`Deleting ${worker} ${name} failed (HTTP ${del.status}): ${apiErrors(del.json, [token])}. Rerun --remove.`);
      console.log(`  deleted ${worker}: ${name}`);
    }
  }
}

async function main() {
  const mode = process.argv[2] ?? "--check";
  if (!["--check", "--apply", "--verify", "--remove"].includes(mode) || process.argv.length > 3) {
    throw new Error("Usage: media-edge-ticket-key.mjs [--check | --apply | --verify | --remove]. Targets are fixed in the script.");
  }
  const token = process.env.CF_MEDIA_KEY_TOKEN ?? "";
  delete process.env.CF_MEDIA_KEY_TOKEN;
  checkTransport();
  if (!token) throw new Error("Set the token first: read -rsp 'Cloudflare API token: ' CF_MEDIA_KEY_TOKEN; echo; export CF_MEDIA_KEY_TOKEN");

  console.log(`Acceptance only: ${MEDIA} and ${FRONTEND} on account ${ACCOUNT_ID}. Production is never touched.\n`);
  await checkToken(token);
  console.log("Token: active, expires within 24 h, sees only the Aladdin account, cannot read R2 or Hyperdrive.");
  await checkTargets(token);
  console.log("Targets: both Workers exist and are bound to Acceptance resources only; edge delivery is off.");
  console.log("\nCurrent secrets (names only):");
  await report(token);

  if (mode === "--check" || mode === "--verify") {
    if (mode === "--check") console.log("\nChecks passed. Nothing was changed. Rerun with --apply to install a new key.");
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await (mode === "--apply" ? apply(token, rl) : remove(token, rl));
    console.log("Now run `clear` and `unset CF_MEDIA_KEY_TOKEN`, and delete the API token in the Cloudflare dashboard.");
  } finally {
    rl.close();
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  main().catch((error) => { console.error(`\n${error.message}`); process.exit(1); });
}
