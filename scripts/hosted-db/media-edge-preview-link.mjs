#!/usr/bin/env node
// Creates the database link for the ACCEPTANCE media edge Worker (aladdin-media-edge-preview):
//   1. generates a random password for the existing `media_edge_worker` login role on the
//      acceptance project (nxossqhdfltcqdwvbewi) and prints SQL that sets it as a SCRAM-SHA-256
//      verifier (a salted one-way hash), so the SQL Editor, its history and the database logs see
//      the verifier, never the password;
//   2. after the owner runs that SQL, creates the Hyperdrive config `aladdin-media-edge-preview`
//      (query caching disabled) with ONE direct HTTPS call to the Cloudflare API.
//
// Why not wrangler: `wrangler hyperdrive create` (4.151.x) accepts the origin password only as a
// command-line argument (`--origin-password` or inside `--connection-string`), which other local
// processes, crash reports and shell tooling can read. The API call puts it in a TLS request body.
//
// Where the password exists, precisely:
//   - in this Node process's memory while it runs (never printed, logged or written to disk);
//   - in the body of one HTTPS POST to api.cloudflare.com (TLS; the script refuses to run with TLS
//     verification disabled, and warns if extra CA certificates are trusted);
//   - in the Hyperdrive configuration Cloudflare stores for the Worker (the API never returns it).
// The database stores only the verifier; Supavisor and Postgres authenticate Hyperdrive with SCRAM,
// which never sends the password itself. The Cloudflare API token is read from the environment
// variable CF_HYPERDRIVE_TOKEN (set with `read -rs`, so it is not echoed or kept in shell history),
// removed from this process's environment at start, and never printed.
//
// Usage (repository root; needs only Node 20+, no `pnpm install`):
//   read -rsp 'Cloudflare API token: ' CF_HYPERDRIVE_TOKEN; echo; export CF_HYPERDRIVE_TOKEN
//   node scripts/hosted-db/media-edge-preview-link.mjs; unset CF_HYPERDRIVE_TOKEN
// The token needs only "Account > Hyperdrive > Edit" on the Aladdin account; give it a short TTL and
// delete it afterwards. Rerunning makes a new password (run the new SQL; delete the old Hyperdrive first).

import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

const PROJECT_REF = "nxossqhdfltcqdwvbewi"; // aladdin-r2-acceptance-20261011, eu-west-1
const LIVE_REF = "kkpkgjrweysgvhvkhzun";
const ROLE = "media_edge_worker";
const CONFIG_NAME = "aladdin-media-edge-preview";
const POOLER_HOST = /^aws-\d+-eu-west-1\.pooler\.supabase\.com$/;
const ITERATIONS = 4096; // Postgres' default scram_iterations
// Self-test only: a local mock of the Cloudflare API. Anything but loopback http is refused.
const API = process.env.MEDIA_EDGE_LINK_TEST_API ?? "https://api.cloudflare.com/client/v4";

/** Postgres SCRAM-SHA-256 verifier: SCRAM-SHA-256$<iter>:<salt>$<StoredKey>:<ServerKey>. */
export function scramVerifier(password, salt, iterations = ITERATIONS) {
  const salted = pbkdf2Sync(password.normalize("NFKC"), salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

export function passwordSql(verifier) {
  // Refuses to run anywhere but a role that already has the reviewed shape (README step 2).
  return `do $$
declare r record;
begin
  select rolcanlogin, rolsuper, rolcreaterole, rolbypassrls,
         pg_has_role('${ROLE}', 'media_edge', 'member') as in_group
    into r from pg_roles where rolname = '${ROLE}';
  if not found then raise exception 'role ${ROLE} does not exist on this project'; end if;
  if not r.rolcanlogin or r.rolsuper or r.rolcreaterole or r.rolbypassrls or not r.in_group then
    raise exception 'role ${ROLE} does not have the expected shape; stop and ask';
  end if;
  execute format('alter role ${ROLE} with password %L', '${verifier}');
  raise notice 'media_edge_worker password set (verifier only)';
end $$;
`;
}

function checkTransport() {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("NODE_TLS_REJECT_UNAUTHORIZED=0 disables TLS checks. Unset it and rerun.");
  if (process.env.NODE_OPTIONS) throw new Error("NODE_OPTIONS is set (it can load code into this process). Unset it for this run.");
  if (process.env.NODE_EXTRA_CA_CERTS) console.warn(`Warning: NODE_EXTRA_CA_CERTS adds trusted CAs (${process.env.NODE_EXTRA_CA_CERTS}).`);
  if (process.env.MEDIA_EDGE_LINK_TEST_API && !/^http:\/\/127\.0\.0\.1:\d+(\/|$)/.test(API)) throw new Error("MEDIA_EDGE_LINK_TEST_API must be a loopback http URL.");
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

const apiErrors = (json, secret) =>
  (json.errors ?? []).map((e) => `${e.code ?? ""} ${e.message ?? ""}`.trim()).join("; ").split(secret).join("<hidden>") || "no detail";

async function main() {
  if (process.argv[2] === "--verifier-for") {
    process.stdout.write(scramVerifier(process.argv[3], Buffer.from(process.argv[4], "base64")) + "\n");
    return;
  }
  const token = process.env.CF_HYPERDRIVE_TOKEN ?? "";
  delete process.env.CF_HYPERDRIVE_TOKEN;
  checkTransport();
  if (!token) throw new Error("Set the token first: read -rsp 'Cloudflare API token: ' CF_HYPERDRIVE_TOKEN; echo; export CF_HYPERDRIVE_TOKEN");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`Acceptance project ${PROJECT_REF} only. Production (${LIVE_REF}) is never touched.\n`);
    const accounts = await api(token, "GET", "/accounts?per_page=50");
    if (!accounts.ok) throw new Error(`The token was refused (HTTP ${accounts.status}): ${apiErrors(accounts.json, token)}`);
    const list = accounts.json.result ?? [];
    if (list.length !== 1) throw new Error(`The token must see exactly one account; it sees ${list.length}. Scope it to the Aladdin account.`);
    const account = list[0];
    const ok = (await rl.question(`Cloudflare account: ${account.name} (${account.id}). Is this the account that runs aladdin-frontend-preview? (yes/no) `)).trim().toLowerCase();
    if (ok !== "yes") throw new Error("Stopped: no changes were made.");

    const existing = await api(token, "GET", `/accounts/${account.id}/hyperdrive/configs`);
    if (!existing.ok) throw new Error(`Cannot list Hyperdrive configs (HTTP ${existing.status}): ${apiErrors(existing.json, token)}. The token needs Hyperdrive: Edit.`);
    if ((existing.json.result ?? []).some((c) => c.name === CONFIG_NAME)) {
      throw new Error(`A Hyperdrive named ${CONFIG_NAME} already exists. Delete it in the dashboard first; no changes were made.`);
    }

    const password = randomBytes(32).toString("base64url"); // 43 URL-safe chars, never printed
    const sql = passwordSql(scramVerifier(password, randomBytes(16)));
    console.log(`\nStep 1. Open https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new (the ACCEPTANCE project),`);
    console.log("paste the SQL below and click Run. It contains a salted one-way hash, not the password. It is not saved anywhere.\n");
    console.log("----- SQL start -----\n" + sql + "----- SQL end -----\n");
    await rl.question("Press Enter once the SQL Editor shows the notice 'media_edge_worker password set' (or Ctrl+C to stop) ");

    console.log("\nStep 2. Session pooler host: Supabase -> Connect (top bar) -> Session pooler.");
    for (let attempt = 1; attempt <= 3; attempt++) {
      const host = (await rl.question("Host (looks like aws-0-eu-west-1.pooler.supabase.com): ")).trim();
      if (!POOLER_HOST.test(host)) { console.log("That is not an eu-west-1 Supabase pooler host. Try again."); continue; }
      const created = await api(token, "POST", `/accounts/${account.id}/hyperdrive/configs`, {
        name: CONFIG_NAME,
        origin: { scheme: "postgresql", host, port: 5432, database: "postgres", user: `${ROLE}.${PROJECT_REF}`, password },
        caching: { disabled: true },
        mtls: { sslmode: "require" },
        origin_connection_limit: 5,
      });
      if (created.ok) {
        const id = created.json.result?.id ?? "";
        const cachingOff = created.json.result?.caching?.disabled === true;
        console.log(`\nDone. Hyperdrive ${CONFIG_NAME} id ${id} (caching ${cachingOff ? "disabled" : "STATE UNKNOWN: check the dashboard"}).`);
        console.log("Paste the id in the project thread (it is not a secret). Then run `clear` and `unset CF_HYPERDRIVE_TOKEN`, and delete the API token.");
        return;
      }
      console.log(`Hyperdrive could not be created (HTTP ${created.status}): ${apiErrors(created.json, password)}`);
      console.log("Usually a wrong host or the SQL not yet run. Check and try again.");
    }
    throw new Error("Stopped after 3 attempts. The role now has a password nobody knows, which is harmless; rerun to start over.");
  } finally {
    rl.close();
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  main().catch((error) => { console.error(`\n${error.message}`); process.exit(1); });
}
