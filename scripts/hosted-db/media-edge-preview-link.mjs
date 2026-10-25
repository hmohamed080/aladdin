#!/usr/bin/env node
// Creates the database link for the ACCEPTANCE media edge Worker (aladdin-media-edge-preview):
//   1. generates a random password for the existing `media_edge_worker` login role on the
//      acceptance project (nxossqhdfltcqdwvbewi) and prints SQL that sets it as a SCRAM-SHA-256
//      verifier, so the password itself never reaches the SQL Editor, its history or the logs;
//   2. after the owner runs that SQL, creates the Hyperdrive config `aladdin-media-edge-preview`
//      (query caching disabled) with wrangler, passing the password as a process argument.
// The password is held in memory only: it is never printed, written to disk or sent anywhere but
// Hyperdrive. Rerunning the script makes a new password (run the new SQL, and delete the old
// Hyperdrive config first if one was created).
//
// Usage, from the repository root after `pnpm install` and `pnpm --dir frontend exec wrangler login`:
//   node scripts/hosted-db/media-edge-preview-link.mjs
// Self-test of the verifier against a throwaway local Postgres (no hosted project):
//   node scripts/hosted-db/media-edge-preview-link.mjs --verifier-for <password> <salt-base64>

import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";

const PROJECT_REF = "nxossqhdfltcqdwvbewi"; // aladdin-r2-acceptance-20261011, eu-west-1
const LIVE_REF = "kkpkgjrweysgvhvkhzun";
const ROLE = "media_edge_worker";
const CONFIG_NAME = "aladdin-media-edge-preview";
const POOLER_HOST = /^aws-\d+-eu-west-1\.pooler\.supabase\.com$/;
const ITERATIONS = 4096; // Postgres' default scram_iterations

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

function wrangler(args, { capture = false } = {}) {
  const bin = join(process.cwd(), "frontend", "node_modules", "wrangler", "bin", "wrangler.js");
  if (!existsSync(bin)) throw new Error("Run from the repository root after `pnpm install` (frontend/node_modules/wrangler is missing).");
  // No shell: the password is one argv entry, never part of a command line string or history.
  return spawnSync(process.execPath, [bin, ...args], { stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit", encoding: "utf8" });
}

async function main() {
  if (process.argv[2] === "--verifier-for") {
    process.stdout.write(scramVerifier(process.argv[3], Buffer.from(process.argv[4], "base64")) + "\n");
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`Acceptance project ${PROJECT_REF} only. Production (${LIVE_REF}) is never touched.\n`);
    const who = wrangler(["whoami"], { capture: true });
    if (who.status !== 0 || /not authenticated/i.test(who.stdout)) throw new Error("wrangler is not logged in: run `pnpm --dir frontend exec wrangler login` first.");
    console.log(who.stdout);
    const ok = (await rl.question("\nIs that the Cloudflare account that runs aladdin-frontend-preview? (yes/no) ")).trim().toLowerCase();
    if (ok !== "yes") throw new Error("Stopped: log in to the right account and rerun.");

    const password = randomBytes(32).toString("base64url"); // 43 chars, URL-safe, never printed
    const sql = passwordSql(scramVerifier(password, randomBytes(16)));
    const sqlPath = join(homedir(), "aladdin-media-edge-worker-password.sql");
    writeFileSync(sqlPath, sql, { mode: 0o600 });
    console.log(`\nStep 1. Open https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new (the ACCEPTANCE project),`);
    console.log(`paste the SQL below (also saved to ${sqlPath}) and click Run. It holds a one-way hash, not the password.\n`);
    console.log("----- SQL start -----\n" + sql + "----- SQL end -----\n");
    await rl.question("Press Enter once the SQL Editor says Success (or Ctrl+C to stop) ");

    console.log(`\nStep 2. Session pooler host: Supabase -> Connect (top bar) -> Session pooler.`);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const host = (await rl.question("Host (looks like aws-0-eu-west-1.pooler.supabase.com): ")).trim();
      if (!POOLER_HOST.test(host)) { console.log("That is not an eu-west-1 Supabase pooler host. Try again."); continue; }
      const run = wrangler([
        "hyperdrive", "create", CONFIG_NAME,
        "--origin-host", host, "--origin-port", "5432", "--database", "postgres",
        "--origin-user", `${ROLE}.${PROJECT_REF}`, "--origin-password", password,
        "--sslmode", "require", "--caching-disabled", "--origin-connection-limit", "5",
      ], { capture: true });
      const out = `${run.stdout ?? ""}${run.stderr ?? ""}`.split(password).join("<hidden>");
      console.log(out);
      if (run.status === 0) {
        const id = out.match(/[0-9a-f]{32}/)?.[0];
        console.log(`Done. Hyperdrive ${CONFIG_NAME}${id ? ` id ${id}` : ""}. Paste the id in the project thread (it is not a secret).`);
        console.log(`You can delete ${sqlPath}.`);
        return;
      }
      if (/already exists/i.test(out)) throw new Error(`A Hyperdrive named ${CONFIG_NAME} already exists. Delete it in the dashboard, then rerun this script.`);
      console.log("Hyperdrive could not connect with that host. Check the host and try again.");
    }
    throw new Error("Stopped after 3 attempts. The role now has a password nobody knows, which is harmless; rerun to start over.");
  } finally {
    rl.close();
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  main().catch((error) => { console.error(`\n${error.message}`); process.exit(1); });
}
