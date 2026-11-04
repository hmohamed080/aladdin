// OPTIONAL integration test against a LOCAL throwaway Postgres that already has migration 20261103090001 applied (never a hosted database).
//   A3_LOCAL_DB_URL=postgresql://postgres:<local password>@127.0.0.1:<port>/<scratch db> A3_LOCAL_PG_PREFIX=17.6 node --test provision-grant-key.integration.test.mjs
// The test deliberately refuses any URL that is not loopback. It is skipped when the variable is absent.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ACCEPTANCE_REF, CONFIRMATION_PHRASE, fingerprint, loadDriver, run } from "./provision-grant-key.mjs";

const URL_ = process.env.A3_LOCAL_DB_URL;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CA = fs.readFileSync(path.join(HERE, "supabase-root-2021-ca.crt"));
const KEY_BYTES = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 53 + 7) % 251));
const KEY = "whsec_" + KEY_BYTES.toString("base64");
const ACCEPTANCE_URI = `postgresql://postgres.${ACCEPTANCE_REF}:pw-from-password-manager@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;

test("real driver, real Postgres: dry run, write, verify, refuse overwrite, schema untouched", { skip: !URL_ }, async () => {
  assert.match(new URL(URL_).hostname, /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/, "integration test only runs against a loopback database");
  const postgres = loadDriver();
  const admin = postgres(URL_, { max: 1, onnotice: () => {} });
  try {
    await admin`delete from app.whatsapp_otp_grant_key`;
    const lines = [];
    const make = (argv) => ({
      argv, ca: CA, pgPrefix: process.env.A3_LOCAL_PG_PREFIX ?? "17",
      write: (s) => lines.push(s),
      hidden: (() => { const a = [ACCEPTANCE_URI, KEY]; return async () => a.shift(); })(),
      line: async () => CONFIRMATION_PHRASE,
      connect: async () => postgres(URL_, { max: 1, prepare: false, onnotice: () => {} }), // the local database stands in for the verified target
    });
    const sigBefore = JSON.stringify(await admin`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','app')`);
    const histBefore = JSON.stringify(await admin`select count(*), max(version) from supabase_migrations.schema_migrations`);

    assert.equal(await run(make([])), 0, lines.join(""));
    assert.equal((await admin`select count(*)::int as n from app.whatsapp_otp_grant_key`)[0].n, 0, "dry run wrote nothing");

    lines.length = 0;
    assert.equal(await run(make(["--write"])), 0, lines.join(""));
    const rows = await admin`select octet_length(key)::int as len, encode(sha256(key), 'hex') as fp, id from app.whatsapp_otp_grant_key`;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].len, 32, "bound as raw bytea (32 bytes), not as text");
    assert.equal(rows[0].fp, fingerprint(KEY_BYTES));
    const text = lines.join("");
    assert.match(text, /Fingerprint match: yes/);
    for (const s of [KEY, KEY.slice(6), KEY_BYTES.toString("hex"), "pw-from-password-manager"]) assert.ok(!text.includes(s));

    lines.length = 0;
    assert.equal(await run(make(["--write"])), 1, "a second run must refuse");
    assert.match(lines.join(""), /never overwrites/);
    assert.equal((await admin`select encode(sha256(key), 'hex') as fp from app.whatsapp_otp_grant_key`)[0].fp, fingerprint(KEY_BYTES), "the existing key is untouched");

    assert.equal(JSON.stringify(await admin`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','app')`), sigBefore);
    assert.equal(JSON.stringify(await admin`select count(*), max(version) from supabase_migrations.schema_migrations`), histBefore, "no migration history change");
  } finally {
    await admin`delete from app.whatsapp_otp_grant_key`;
    await admin.end({ timeout: 2 });
  }
});
