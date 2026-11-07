import { test } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import { PassThrough } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACCEPTANCE_REF, CONFIRMATION_PHRASE, PINNED_CA_SHA256, PRODUCTION_REF, REQUIRED_MIGRATION,
  fingerprint, makeOut, parseTarget, readLine, run, validateGrantKey, verifyPinnedCa,
} from "./provision-grant-key.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CA = fs.readFileSync(path.join(HERE, "supabase-root-2021-ca.crt"));
const KEY_BYTES = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 37 + 11) % 251));
const KEY = "whsec_" + KEY_BYTES.toString("base64");
const URI = `postgresql://postgres.${ACCEPTANCE_REF}:S3cr3t-Pa55word%21@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;

// ---- validateGrantKey ------------------------------------------------------------------------------------------------------------
test("accepts a whsec_ key of >= 32 canonical base64 bytes and trims paste whitespace", () => {
  assert.deepEqual(validateGrantKey(KEY).bytes, KEY_BYTES);
  assert.deepEqual(validateGrantKey(`  ${KEY}\r\n`).bytes, KEY_BYTES);
  assert.equal(validateGrantKey("whsec_" + Buffer.alloc(64, 0).map((_, i) => (i * 7 + 3) % 256).toString("base64")).bytes.length, 64);
});

test("refuses empty, wrong prefix, non-base64, short, non-canonical, low-entropy and oversized keys", () => {
  const b64 = (n, f = (i) => (i * 37 + 11) % 251) => Buffer.from(Array.from({ length: n }, (_, i) => f(i))).toString("base64");
  const cases = [
    ["", "empty"], ["   ", "empty"], [KEY.slice(6), "format"], ["v1," + KEY, "format"], ["whsec_", "format"],
    ["whsec_" + b64(31), "too_short"], ["whsec_not base64!", "format"], ["whsec_" + b64(32).slice(0, -2), "not_canonical_base64"],
    ["whsec_" + Buffer.alloc(40, 7).toString("base64"), "low_entropy"], ["whsec_" + "A".repeat(300), "too_long"], [KEY + "\n" + KEY, "format"],
  ];
  for (const [input, error] of cases) assert.equal(validateGrantKey(input).error, error, JSON.stringify(input).slice(0, 40));
  assert.equal(validateGrantKey(undefined).error, "empty");
});

// ---- parseTarget -----------------------------------------------------------------------------------------------------------------
test("accepts only the Acceptance pooler or the Acceptance direct host", () => {
  const ok = parseTarget(URI);
  assert.equal(ok.config.kind, "pooler");
  assert.equal(ok.config.user, `postgres.${ACCEPTANCE_REF}`);
  assert.equal(ok.config.password, "S3cr3t-Pa55word!");
  assert.equal(parseTarget(`postgresql://postgres:pw@db.${ACCEPTANCE_REF}.supabase.co:5432/postgres`).config.kind, "direct");
  assert.equal(parseTarget(URI.replace(":5432", ":6543")).config.port, 6543);
});

test("REFUSES Production in any part or encoding, and anything that is not exactly Acceptance", () => {
  const bad = {
    "production user": `postgresql://postgres.${PRODUCTION_REF}:pw@aws-0-eu-west-3.pooler.supabase.com:5432/postgres`,
    "production direct host": `postgresql://postgres:pw@db.${PRODUCTION_REF}.supabase.co:5432/postgres`,
    "production in the password": `postgresql://postgres.${ACCEPTANCE_REF}:${PRODUCTION_REF}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
    "production in the query": `${URI}?options=${PRODUCTION_REF}`,
    "production, upper case": URI.replace("@", `@x.${PRODUCTION_REF.toUpperCase()}.`),
    "production, percent-encoded": `postgresql://postgres.${ACCEPTANCE_REF}:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?x=%6b%6bpkgjrweysgvhvkhzun`,
    "another project": "postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
    "pooler host without the ref user": "postgresql://postgres:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
    "foreign host": `postgresql://postgres.${ACCEPTANCE_REF}:pw@db.example.com:5432/postgres`,
    "lookalike host": `postgresql://postgres.${ACCEPTANCE_REF}:pw@aws-0-eu-west-1.pooler.supabase.com.evil.test:5432/postgres`,
    "wrong database": URI.replace("/postgres", "/other"),
    "wrong port": URI.replace(":5432", ":9999"),
    "https": "https://nxossqhdfltcqdwvbewi.supabase.co",
    "no password": `postgresql://postgres.${ACCEPTANCE_REF}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
    "empty": "",
    "garbage": "not a uri",
  };
  for (const [name, uri] of Object.entries(bad)) assert.ok(parseTarget(uri).error, name);
  assert.equal(parseTarget(bad["production user"]).error, "production_refused");
  // a second "@" belongs to the password (WHATWG URL rule); the host that is connected to is still the genuine Acceptance pooler
  const trick = parseTarget(`postgresql://postgres.${ACCEPTANCE_REF}:pw@evil.test@aws-0-eu-west-1.pooler.supabase.com/postgres`);
  assert.equal(trick.config.host, "aws-0-eu-west-1.pooler.supabase.com");
  assert.equal(trick.config.password, "pw@evil.test");
  assert.equal(parseTarget(bad["production, percent-encoded"]).error ?? "x", parseTarget(bad["production, percent-encoded"]).error);
});

test("the pinned CA file is the expected certificate and a tampered one is rejected", () => {
  assert.equal(verifyPinnedCa(CA), true);
  assert.equal(PINNED_CA_SHA256.length, 64);
  const pem = CA.toString("utf8").split("\n");
  pem[2] = pem[2].replace(/./, (c) => (c === "A" ? "B" : "A"));
  assert.equal(verifyPinnedCa(Buffer.from(pem.join("\n"))), false);
});

// ---- the run, against a scripted fake database ----------------------------------------------------------------------------------
function fakeDb(over = {}) {
  const state = {
    version: "17.11", history: { n: 200, latest: REQUIRED_MIGRATION }, present: true, rls: true, rows: [], sig: { relations: 165, functions: 718, constraints: 936, policies: 147, triggers: 145 },
    storedFingerprint: null, mutateStored: false, throwOnVerify: false, log: [], begun: [], committed: false, ended: false, ...over,
  };
  const exec = (text, params = []) => {
    state.log.push({ text, params });
    if (/server_version/.test(text)) return [{ server_version: state.version, db: "postgres" }];
    if (/supabase_migrations/.test(text)) return [state.history];
    if (/to_regclass/.test(text)) return [{ present: state.present, rls: state.rls }];
    if (/select count\(\*\)::int as n from app\.whatsapp_otp_grant_key/.test(text)) return [{ n: state.rows.length }];
    if (/pg_policies/.test(text)) return [state.sig];
    if (/^lock table/.test(text)) return [];
    if (/^insert into app\.whatsapp_otp_grant_key/.test(text)) {
      if (state.rows.length) return [];
      state.rows.push(Buffer.from(params[0]));
      return [{ id: 1 }];
    }
    if (/encode\(sha256/.test(text)) {
      if (state.throwOnVerify) throw new TypeError(`boom ${KEY}`);
      const row = state.rows[0];
      if (!row) return [];
      const fp = state.mutateStored ? "0".repeat(64) : fingerprint(row);
      return [{ fp, len: row.length }];
    }
    throw new Error("unexpected statement: " + text.slice(0, 60));
  };
  const tx = { unsafe: async (text, params) => exec(text, params) };
  const sql = {
    async begin(a, b) {
      const fn = typeof a === "function" ? a : b;
      state.begun.push(typeof a === "string" ? a : "read write");
      const snapshot = state.rows.slice();
      try { const r = await fn(tx); state.committed = true; return r; } catch (e) { state.rows = snapshot; throw e; }
    },
    async end() { state.ended = true; },
  };
  return { state, sql };
}

function harness({ db = fakeDb(), argv = [], uri = URI, key = KEY, confirm = CONFIRMATION_PHRASE, connectError = null } = {}) {
  const lines = [];
  const prompts = [];
  const hiddenAnswers = [uri, key];
  const deps = {
    argv, ca: CA, pgPrefix: "17.11",
    write: (s) => lines.push(s),
    hidden: async (p) => { prompts.push(p); return hiddenAnswers.shift(); },
    line: async (p) => { prompts.push(p); return confirm; },
    connect: async (config, ca) => { if (connectError) throw connectError; deps.seen = { config, ca }; return db.sql; },
  };
  return { deps, db, lines, prompts, output: () => lines.join("") };
}

const inserts = (db) => db.state.log.filter((l) => /^insert/.test(l.text));
const noSecretIn = (text) => {
  for (const secret of [KEY, KEY.slice(6), KEY_BYTES.toString("hex"), "S3cr3t-Pa55word", "S3cr3t-Pa55word%21", fingerprint(KEY_BYTES), URI]) assert.ok(!text.includes(secret), "output leaked a secret");
};

test("DRY RUN (default) verifies everything and writes nothing", async () => {
  const h = harness();
  assert.equal(await run(h.deps), 0);
  assert.equal(inserts(h.db).length, 0);
  assert.ok(h.db.state.log.every((l) => !/^(insert|update|delete|lock|create|alter|drop)/i.test(l.text)));
  assert.deepEqual(h.db.state.begun, ["read only"]);
  assert.match(h.output(), /DRY RUN complete: nothing was written/);
  assert.equal(h.prompts.length, 2, "no confirmation is asked in a dry run");
  assert.equal(h.db.state.ended, true);
  noSecretIn(h.output());
});

test("--write inserts exactly one row through a bound parameter, verifies it and reports non-sensitive results only", async () => {
  const h = harness({ argv: ["--write"] });
  assert.equal(await run(h.deps), 0);
  const ins = inserts(h.db);
  assert.equal(ins.length, 1);
  assert.equal(ins[0].params.length, 1);
  assert.ok(Buffer.isBuffer(ins[0].params[0]) || ins[0].params[0] instanceof Uint8Array || ins[0].params[0].length === 0, "bytes were bound (and zeroed afterwards)");
  // the statement text is constant and holds no key material in any encoding
  assert.match(ins[0].text, /values \(1, \$1\)/);
  for (const needle of [KEY.slice(6), KEY_BYTES.toString("hex"), "whsec_"]) assert.ok(!ins[0].text.includes(needle));
  assert.equal(h.db.state.rows.length, 1);
  assert.match(h.output(), /Rows: 1 \(expected 1\)\. Fingerprint match: yes/);
  assert.match(h.output(), /Schema signature unchanged: yes/);
  assert.match(h.output(), /Migration history unchanged: yes \(200 rows/);
  noSecretIn(h.output());
  assert.deepEqual(h.db.state.begun, ["read only", "read write", "read only"]);
  assert.equal(h.db.state.ended, true);
});

test("never accepts a key or URI from arguments, and unknown flags are a usage error", async () => {
  for (const argv of [["--key", KEY], [URI], ["--write", "--uri", URI], ["--env=production"]]) {
    const h = harness({ argv });
    assert.equal(await run(h.deps), 2);
    assert.equal(h.prompts.length, 0);
    assert.equal(h.db.state.log.length, 0);
    noSecretIn(h.output());
  }
});

test("refuses Production before connecting; no connection attempt, no prompt for the key", async () => {
  let connected = false;
  const h = harness({ uri: `postgresql://postgres.${PRODUCTION_REF}:pw@aws-0-eu-west-3.pooler.supabase.com:5432/postgres`, argv: ["--write"] });
  const real = h.deps.connect;
  h.deps.connect = async (...a) => { connected = true; return real(...a); };
  assert.equal(await run(h.deps), 1);
  assert.equal(connected, false);
  assert.equal(h.prompts.length, 1, "the key is not even requested");
  assert.match(h.output(), /Production project/);
  assert.equal(h.db.state.log.length, 0);
});

test("refuses an invalid key before connecting", async () => {
  let connected = false;
  const h = harness({ key: "whsec_" + Buffer.alloc(8, 5).toString("base64"), argv: ["--write"] });
  h.deps.connect = async () => { connected = true; return h.db.sql; };
  assert.equal(await run(h.deps), 1);
  assert.equal(connected, false);
  assert.match(h.output(), /key is not valid \(too_short\)/);
});

test("refuses to overwrite: an existing row stops the run with nothing written", async () => {
  const db = fakeDb({ rows: [Buffer.alloc(32, 9)] });
  const h = harness({ db, argv: ["--write"] });
  assert.equal(await run(h.deps), 1);
  assert.match(h.output(), /never overwrites/);
  assert.equal(inserts(db).length, 0);
  assert.equal(db.state.rows.length, 1);
  assert.equal(db.state.rows[0].equals(Buffer.alloc(32, 9)), true);
});

test("refuses a database that is not the Acceptance schema state (wrong version, missing migration, missing table, RLS off)", async () => {
  const cases = [
    [{ version: "17.6" }, /server version does not match/],
    [{ history: { n: 199, latest: "20261030090002" } }, /is not applied/],
    [{ present: false }, /does not exist/],
    [{ rls: false }, /row-level security/],
  ];
  for (const [over, message] of cases) {
    const db = fakeDb(over);
    const h = harness({ db, argv: ["--write"] });
    assert.equal(await run(h.deps), 1);
    assert.match(h.output(), message);
    assert.equal(inserts(db).length, 0);
    assert.equal(h.prompts.length, 2, "the typed confirmation is never reached");
  }
});

test("a wrong confirmation phrase cancels with no write", async () => {
  for (const confirm of ["", "yes", "provision acceptance", "PROVISION PRODUCTION"]) {
    const h = harness({ argv: ["--write"], confirm });
    assert.equal(await run(h.deps), 1);
    assert.match(h.output(), /confirmation phrase did not match/);
    assert.equal(inserts(h.db).length, 0);
  }
});

test("a fingerprint mismatch inside the transaction rolls everything back", async () => {
  const db = fakeDb({ mutateStored: true });
  const h = harness({ db, argv: ["--write"] });
  assert.equal(await run(h.deps), 1);
  assert.match(h.output(), /fingerprint mismatch\); rolled back/);
  assert.equal(db.state.rows.length, 0, "the inserted row was rolled back");
});

test("a connection failure is reported by code only, never with the URI or password", async () => {
  const err = Object.assign(new Error(`password authentication failed for ${URI}`), { code: "28P01" });
  const h = harness({ connectError: err });
  assert.equal(await run(h.deps), 1);
  assert.match(h.output(), /could not connect \(28P01\)/);
  noSecretIn(h.output());
});

test("connects with TLS material from the pinned CA and the verified Acceptance config only", async () => {
  const h = harness();
  await run(h.deps);
  assert.equal(h.deps.seen.config.host, "aws-0-eu-west-1.pooler.supabase.com");
  assert.equal(h.deps.seen.config.user, `postgres.${ACCEPTANCE_REF}`);
  assert.equal(verifyPinnedCa(h.deps.seen.ca), true);
});

test("an unexpected crash is reported by name only and the key bytes are still zeroed", async () => {
  const db = fakeDb({ throwOnVerify: true });
  const h = harness({ db, argv: ["--write"] });
  assert.equal(await run(h.deps), 1);
  assert.match(h.output(), /failed safely \(TypeError\)/);
  noSecretIn(h.output());
  const bound = inserts(db)[0].params[0];
  assert.ok([...bound].every((b) => b === 0), "the key buffer was zeroed after the run");
  assert.equal(db.state.rows.length, 0, "the transaction rolled back");
});

test("the output channel scrubs any registered secret, whatever is printed", () => {
  const lines = [];
  const out = makeOut((s) => lines.push(s), ["topsecret-value", "p4ss"]);
  out("the value topsecret-value and p4ss appear");
  assert.equal(lines.join(""), "the value [hidden] and [hidden] appear\n");
});

test("source hygiene: no file writes, no env/arg key input, no DDL, no console logging of values", () => {
  const src = fs.readFileSync(path.join(HERE, "provision-grant-key.mjs"), "utf8");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/writeFile|appendFile|createWriteStream|mkdtemp/.test(code), "must not write files");
  assert.ok(!/process\.env/.test(code), "must not read the key or URI from the environment");
  assert.ok(!/console\.(log|error|warn|info|debug)/.test(code), "must print only through the scrubbing channel");
  assert.ok(!/\b(create|alter|drop|truncate|grant|revoke)\s+(table|function|schema|index|policy|role|extension)\b/i.test(code), "must run no DDL");
  assert.ok(!/\bupdate\s+app\.|\bdelete\s+from\b/i.test(code), "must never update or delete");
  assert.ok(!/migrations?\//.test(code.replace(/supabase_migrations/g, "")), "must not touch migration files");
  assert.match(code, /values \(1, \$1\)/);
});

// ---- Regression: confirmation input must go through the REAL readline implementation (not a mocked callback) ----
function realLine(input) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const out = [];
  stdout.on("data", (d) => out.push(String(d)));
  const promise = readLine("Type it: ", { stdin, stdout });
  if (input === null) stdin.end();
  else stdin.write(input);
  return { promise, out };
}

test("readLine (real readline): returns the typed line, not the empty string from the close handler", async () => {
  const { promise, out } = realLine(CONFIRMATION_PHRASE + "\n");
  assert.equal(await promise, CONFIRMATION_PHRASE);
  assert.match(out.join(""), /Type it:/);
});

test("readLine (real readline): handles CRLF and keeps the line when input ends without a newline", async () => {
  assert.equal(await realLine(CONFIRMATION_PHRASE + "\r\n").promise, CONFIRMATION_PHRASE);
  const s = new PassThrough();
  const p = readLine("x", { stdin: s, stdout: new PassThrough() });
  s.end(CONFIRMATION_PHRASE);
  assert.equal(await p, CONFIRMATION_PHRASE);
});

test("readLine (real readline): closed input with no line resolves to the empty string", async () => {
  assert.equal(await realLine(null).promise, "");
});

test("end to end with the real readLine: correct phrase writes, wrong phrase cancels with no write", async () => {
  for (const [typed, expectWrite] of [[CONFIRMATION_PHRASE + "\n", true], ["provision acceptance\n", false], ["\n", false]]) {
    const h = harness({ argv: ["--write"] });
    h.deps.line = (p) => { h.prompts.push(p); return realLine(typed).promise; };
    const code = await run(h.deps);
    assert.equal(inserts(h.db).length, expectWrite ? 1 : 0, JSON.stringify(typed));
    assert.equal(code, expectWrite ? 0 : 1);
    if (!expectWrite) assert.match(h.output(), /cancelled: the confirmation phrase did not match; nothing was written/);
    noSecretIn(h.output());
  }
});
