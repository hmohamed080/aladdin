import { test } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACCEPTANCE_PROFILE, ACCEPTANCE_REF, APPROVAL_REFERENCE, CONFIRMATION_PHRASE, PRODUCTION_CONFIRMATION_PHRASE, PRODUCTION_PROFILE, PRODUCTION_REF,
  fingerprint, parseProductionTarget, parseTarget, run,
} from "./provision-grant-key.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CA = fs.readFileSync(path.join(HERE, "supabase-root-2021-ca.crt"));
const KEY_BYTES = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 53 + 17) % 251));
const KEY = "whsec_" + KEY_BYTES.toString("base64");
const PROD_URI = `postgresql://postgres.${PRODUCTION_REF}:Pr0d-S3cret-Pa55%21@aws-0-eu-west-3.pooler.supabase.com:5432/postgres`;
const ACC_URI = `postgresql://postgres.${ACCEPTANCE_REF}:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;
const APPROVAL = "PROD-GRANT-20261107-OWNER1";

function fakeDb(over = {}) {
  const state = {
    version: "17.6", history: { n: 204, latest: "20261107090002" }, present: true, rls: true, rows: [],
    sig: { relations: 170, functions: 727, constraints: 940, policies: 150, triggers: 146 }, log: [], begun: [], ended: false, ...over,
  };
  const exec = (text, params = []) => {
    state.log.push({ text, params });
    if (/server_version/.test(text)) return [{ server_version: state.version, db: "postgres" }];
    if (/supabase_migrations/.test(text)) return [state.history];
    if (/to_regclass/.test(text)) return [{ present: state.present, rls: state.rls }];
    if (/select count\(\*\)::int as n from app\.whatsapp_otp_grant_key/.test(text)) return [{ n: state.rows.length }];
    if (/pg_policies/.test(text)) return [state.sig];
    if (/^lock table/.test(text)) return [];
    if (/^insert into app\.whatsapp_otp_grant_key/.test(text)) { if (state.rows.length) return []; state.rows.push(Buffer.from(params[0])); return [{ id: 1 }]; }
    if (/encode\(sha256/.test(text)) { const row = state.rows[0]; return row ? [{ fp: fingerprint(row), len: row.length }] : []; }
    throw new Error("unexpected statement: " + text.slice(0, 60));
  };
  const tx = { unsafe: async (text, params) => exec(text, params) };
  const sql = {
    async begin(a, b) {
      const fn = typeof a === "function" ? a : b;
      state.begun.push(typeof a === "string" ? a : "read write");
      const snapshot = state.rows.slice();
      try { return await fn(tx); } catch (e) { state.rows = snapshot; throw e; }
    },
    async end() { state.ended = true; },
  };
  return { state, sql };
}

function harness({ db = fakeDb(), argv = [], uri = PROD_URI, key = KEY, confirm = PRODUCTION_CONFIRMATION_PHRASE, ci = false, profile = PRODUCTION_PROFILE } = {}) {
  const lines = [], prompts = [];
  const hiddenAnswers = [uri, key];
  const deps = {
    argv, ca: CA, profile, ci,
    write: (s) => lines.push(s),
    hidden: async (p) => { prompts.push(p); return hiddenAnswers.shift(); },
    line: async (p) => { prompts.push(p); return confirm; },
    connect: async (config) => { deps.seen = config; deps.connected = true; return db.sql; },
  };
  return { deps, db, lines, prompts, output: () => lines.join("") };
}
const inserts = (db) => db.state.log.filter((l) => /^insert/.test(l.text));
const noSecretIn = (text) => { for (const secret of [KEY, KEY.slice(6), KEY_BYTES.toString("hex"), "Pr0d-S3cret-Pa55", fingerprint(KEY_BYTES), PROD_URI]) assert.ok(!text.includes(secret), "output leaked a secret"); };
const WRITE = ["--write", `--approval=${APPROVAL}`];

// ---- the target ------------------------------------------------------------------------------------------------------------------
test("accepts only the exact Production pooler or direct host", () => {
  assert.equal(parseProductionTarget(PROD_URI).config.user, `postgres.${PRODUCTION_REF}`);
  assert.equal(parseProductionTarget(`postgresql://postgres:pw@db.${PRODUCTION_REF}.supabase.co:5432/postgres`).config.kind, "direct");
  for (const [name, uri] of Object.entries({
    "acceptance pooler": ACC_URI,
    "acceptance in the password": PROD_URI.replace("Pr0d-S3cret-Pa55%21", ACCEPTANCE_REF),
    "acceptance percent-encoded": `${PROD_URI}?x=%6e%78ossqhdfltcqdwvbewi`,
    "acceptance upper case": PROD_URI.replace("@", `@x.${ACCEPTANCE_REF.toUpperCase()}.`),
    "another project": "postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-eu-west-3.pooler.supabase.com:5432/postgres",
    "foreign host": `postgresql://postgres.${PRODUCTION_REF}:pw@db.example.com:5432/postgres`,
    "wrong database": PROD_URI.replace("/postgres", "/other"), "wrong port": PROD_URI.replace(":5432", ":9999"),
    "no password": `postgresql://postgres.${PRODUCTION_REF}@aws-0-eu-west-3.pooler.supabase.com:5432/postgres`, "empty": "", "garbage": "nope",
  })) assert.ok(parseProductionTarget(uri).error, name);
  assert.equal(parseProductionTarget(ACC_URI).error, "acceptance_refused");
});

test("the two targets are mutually exclusive: the Acceptance parser still refuses Production and the Production parser refuses Acceptance", () => {
  assert.equal(parseTarget(PROD_URI).error, "production_refused");
  assert.equal(parseProductionTarget(ACC_URI).error, "acceptance_refused");
  assert.ok(parseTarget(ACC_URI).config && parseProductionTarget(PROD_URI).config);
});

test("the approval reference has a fixed shape", () => {
  for (const ok of ["PROD-GRANT-20261107-OWNER1", "PROD-GRANT-20261231-AB12"]) assert.ok(APPROVAL_REFERENCE.test(ok), ok);
  for (const bad of ["", "prod-grant-20261107-owner1", "PROD-GRANT-2026-OWNER1", "PROD-GRANT-20261107-", "PROD-GRANT-20261107-A", "PROD-GRANT-20261107-OWNER1 ", "ACCEPT-20261107-OWNER1", "PROD-GRANT-20261107-OWNER1-EXTRA"]) assert.ok(!APPROVAL_REFERENCE.test(bad), JSON.stringify(bad));
});

// ---- dry run ---------------------------------------------------------------------------------------------------------------------
test("a DRY RUN needs no approval, is read-only and writes nothing", async () => {
  const h = harness();
  assert.equal(await run(h.deps), 0);
  assert.equal(inserts(h.db).length, 0);
  assert.ok(h.db.state.log.every((l) => !/^(insert|update|delete|lock|create|alter|drop)/i.test(l.text)));
  assert.deepEqual(h.db.state.begun, ["read only"]);
  assert.match(h.output(), /Production grant-key provisioning \(dry run, no write\)\. Target: Production project only\./);
  assert.match(h.output(), /Target verified: Production/);
  assert.equal(h.prompts.length, 2, "no confirmation is asked in a dry run");
  assert.match(h.prompts[0], /PRODUCTION database URI/);
  assert.match(h.prompts[1], /OTP_ADMIN_GRANT_SECRET_PRODUCTION/);
  noSecretIn(h.output());
});

// ---- the approval gates ----------------------------------------------------------------------------------------------------------
test("a WRITE without a valid approval reference is refused BEFORE any prompt or connection", async () => {
  for (const argv of [["--write"], ["--write", "--approval="], ["--write", "--approval=APPROVED"], ["--write", "--approval=prod-grant-20261107-owner1"], ["--write", "--approval=PROD-GRANT-2026-OWNER1"]]) {
    const h = harness({ argv });
    assert.equal(await run(h.deps), 1, argv.join(" "));
    assert.equal(h.prompts.length, 0, "no prompt");
    assert.ok(!h.deps.connected, "no connection");
    assert.match(h.output(), /needs --approval=PROD-GRANT-YYYYMMDD-XXXX/);
  }
});

test("a Production WRITE never runs in CI", async () => {
  const h = harness({ argv: WRITE, ci: true });
  assert.equal(await run(h.deps), 1);
  assert.equal(h.prompts.length, 0);
  assert.ok(!h.deps.connected);
  assert.match(h.output(), /never runs in CI/);
});

test("--approval is not an option of the Acceptance profile (it cannot be used to smuggle a flag)", async () => {
  const h = harness({ argv: ["--approval=PROD-GRANT-20261107-OWNER1"], profile: ACCEPTANCE_PROFILE, uri: ACC_URI });
  assert.equal(await run(h.deps), 2);
  assert.equal(h.prompts.length, 0);
});

test("an Acceptance connection string is refused for Production, and a Production one for Acceptance, before any connection", async () => {
  const wrongTarget = harness({ uri: ACC_URI });
  assert.equal(await run(wrongTarget.deps), 1);
  assert.match(wrongTarget.output(), /mentions the Acceptance project/);
  assert.ok(!wrongTarget.deps.connected);
  const wrongProfile = harness({ uri: PROD_URI, profile: ACCEPTANCE_PROFILE });
  assert.equal(await run(wrongProfile.deps), 1);
  assert.match(wrongProfile.output(), /mentions the Production project/);
  assert.ok(!wrongProfile.deps.connected);
});

test("the Acceptance confirmation phrase does not authorize a Production write", async () => {
  assert.notEqual(CONFIRMATION_PHRASE, PRODUCTION_CONFIRMATION_PHRASE);
  const h = harness({ argv: WRITE, confirm: CONFIRMATION_PHRASE });
  assert.equal(await run(h.deps), 1);
  assert.equal(inserts(h.db).length, 0);
  assert.match(h.output(), /cancelled: the confirmation phrase did not match; nothing was written/);
});

// ---- the database checks ---------------------------------------------------------------------------------------------------------
test("refuses a database that is not Production: wrong Postgres, short history, missing table, no RLS, or a key already present", async () => {
  const cases = [
    [{ version: "17.11" }, /server version does not match Production/],
    [{ history: { n: 163, latest: "20261015090053" } }, /migration 20261103090001 is not applied/],
    [{ history: { n: 150, latest: "20261107090002" } }, /too short to be the Production database/],
    [{ present: false }, /grant-key does not exist|does not exist/],
    [{ rls: false }, /row-level security/],
    [{ rows: [Buffer.alloc(32, 9)] }, /already exists/],
  ];
  for (const [over, message] of cases) {
    const h = harness({ db: fakeDb(over), argv: WRITE });
    assert.equal(await run(h.deps), 1, JSON.stringify(over));
    assert.match(h.output(), message, JSON.stringify(over));
    assert.equal(inserts(h.db).length, 0, "nothing written");
    assert.equal(h.prompts.length, 2, "refused before the confirmation");
  }
});

// ---- the write -------------------------------------------------------------------------------------------------------------------
test("the approved WRITE inserts exactly one row as a bound parameter, verifies it, and prints the approval and a fingerprint, never the key", async () => {
  const h = harness({ argv: WRITE });
  assert.equal(await run(h.deps), 0);
  const ins = inserts(h.db);
  assert.equal(ins.length, 1);
  assert.ok(!ins[0].text.includes(KEY) && !ins[0].text.includes(KEY_BYTES.toString("hex")), "the key is never in the SQL text");
  assert.equal(Buffer.compare(Buffer.from(ins[0].params[0]), KEY_BYTES) === 0 || h.db.state.rows.length === 1, true);
  assert.deepEqual(h.db.state.begun, ["read only", "read write", "read only"]);
  const out = h.output();
  assert.match(out, /WRITE mode\)\. Target: Production project only\. Approval reference: PROD-GRANT-20261107-OWNER1\./);
  assert.match(out, /Provisioned\. Rows: 1 \(expected 1\)\. Fingerprint match: yes/);
  assert.match(out, /configured for Production\. Record in the release record: approval PROD-GRANT-20261107-OWNER1, fingerprint [0-9a-f]{12},/);
  noSecretIn(out);
  assert.equal(h.deps.seen.user, `postgres.${PRODUCTION_REF}`);
  assert.equal(h.db.state.ended, true);
});

test("a second run never overwrites the key", async () => {
  const db = fakeDb();
  assert.equal(await run(harness({ db, argv: WRITE }).deps), 0);
  const again = harness({ db, argv: WRITE });
  assert.equal(await run(again.deps), 1);
  assert.match(again.output(), /already exists/);
  assert.equal(db.state.rows.length, 1);
  noSecretIn(again.output());
});

// ---- source hygiene --------------------------------------------------------------------------------------------------------------
test("the Production entrypoint adds no key input path, file write, DDL or value logging", () => {
  const src = fs.readFileSync(path.join(HERE, "provision-grant-key-production.mjs"), "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/writeFile|appendFile|createWriteStream/.test(src), "no file writes");
  assert.ok(!/console\./.test(src), "no console logging");
  assert.ok(!/process\.argv\.slice\(2\)\.(find|map)|process\.stdin\.read|readFileSync\(0/.test(src), "no argument or pipe key input");
  assert.ok(!/\b(create|alter|drop)\s+(table|function|policy)\b/i.test(src), "no DDL");
  assert.ok(/ci: Boolean\(process\.env\.CI\)/.test(src), "the CI flag is the only environment read, and it only REFUSES");
  assert.equal([...src.matchAll(/process\.env/g)].length, 1);
});
