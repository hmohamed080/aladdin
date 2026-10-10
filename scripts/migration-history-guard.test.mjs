import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MalformedInputError,
  classify,
  crossCheckDryRun,
  evaluate,
  parseCliJson,
  parseDryRun,
  parseMigrationList,
} from "./migration-history-guard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, "migration-history-guard.mjs");

const row = (local, remote = local) => ({ local, remote, time: "x" });
const list = (...rows) => JSON.stringify({ migrations: rows });
const run = (rows) => classify(parseMigrationList(list(...rows)));

test("exact parity is compatible and up to date", () => {
  const r = run([row("20260729000000"), row("20260802090001"), row("20261007090007")]);
  assert.equal(r.upToDate, true);
  assert.equal(r.matched, 3);
  assert.deepEqual([r.pending, r.remoteOnly, r.outOfOrder], [[], [], []]);
  assert.equal(r.latestRemote, "20261007090007");
  const out = evaluate(r);
  assert.equal(out.exitCode, 0);
  assert.match(out.lines.join("\n"), /compatible: 3 applied, latest remote 20261007090007/);
});

test("a normal pending migration (newer than every remote one) is valid in plan mode", () => {
  const r = run([row("20261007090007"), row("20261008090001", ""), row("20261008090002", "")]);
  assert.deepEqual(r.pending, ["20261008090001", "20261008090002"]);
  assert.equal(r.upToDate, false);
  const out = evaluate(r, { expect: "plan" });
  assert.equal(out.exitCode, 0);
  assert.match(out.lines.join("\n"), /Pending migrations \(valid/);
  assert.match(out.lines.join("\n"), /\(2 pending\)/);
});

test("the same pending migrations fail when the database must already be up to date", () => {
  const r = run([row("20261007090007"), row("20261008090001", ""), row("20261008090002", "")]);
  const out = evaluate(r, { expect: "up-to-date" });
  assert.equal(out.exitCode, 1);
  const text = out.lines.join("\n");
  assert.match(text, /Database schema behind application\./);
  assert.match(text, /Pending migrations:\n {2}20261008090001\n {2}20261008090002/);
});

test("a remote-only version is history drift and fails", () => {
  const r = run([row("", "20260929090001"), row("", "20260930100001"), row("20261007090007")]);
  assert.deepEqual(r.remoteOnly, ["20260929090001", "20260930100001"]);
  assert.equal(r.drift, true);
  const out = evaluate(r);
  assert.equal(out.exitCode, 1);
  const text = out.lines.join("\n");
  assert.match(text, /Database migration history drift detected\./);
  assert.match(text, /\n {2}20260930100001/);
  assert.match(text, /Do not use\n`supabase migration repair`/);
});

test("a local-only version older than an applied remote version is out of order and fails", () => {
  const r = run([row("20260927090001"), row("20260928090001", ""), row("20260929090001")]);
  assert.deepEqual(r.outOfOrder, ["20260928090001"]);
  assert.deepEqual(r.pending, []);
  const out = evaluate(r);
  assert.equal(out.exitCode, 1);
  assert.match(out.lines.join("\n"), /Out-of-order local migration detected\.\n {2}20260928090001 is missing remotely but later migrations are already applied \(latest remote: 20260929090001\)\./);
});

test("drift and out-of-order are both reported when both are present", () => {
  const r = run([row("20260928090001", ""), row("", "20260929090001"), row("20260930090001")]);
  const text = evaluate(r).lines.join("\n");
  assert.match(text, /history drift detected/);
  assert.match(text, /Out-of-order local migration detected/);
});

test("a brand new database (nothing applied yet) treats every local migration as pending", () => {
  const r = run([row("20260729000000", ""), row("20260802090001", "")]);
  assert.equal(r.latestRemote, null);
  assert.deepEqual(r.pending, ["20260729000000", "20260802090001"]);
  assert.deepEqual(r.outOfOrder, []);
  assert.equal(evaluate(r).exitCode, 0);
});

test("the exact situation that blocked a clean main: 10 remote-only versions", () => {
  const remoteOnly = ["20260929090001", "20260929100001", "20260930090001", "20260930090002", "20260930100001"];
  const r = run([row("20260928090001"), ...remoteOnly.map((v) => row("", v)), row("20261007090007")]);
  assert.deepEqual(r.remoteOnly, remoteOnly);
  assert.equal(evaluate(r).exitCode, 1);
});

test("malformed CLI output is rejected (fail closed)", () => {
  const bad = [
    ["not json at all", /no JSON object/],
    ["", /no JSON object/],
    ['{"migrations": "nope"}', /missing "migrations" array/],
    ["{}", /missing "migrations" array/],
    ['{"migrations":[null]}', /not an object/],
    ['{"migrations":[{"local":"","remote":""}]}', /neither a local nor a remote/],
    ['{"migrations":[{"local":"123","remote":""}]}', /14-digit/],
    ['{"migrations":[{"local":"20260101000000","remote":"20260202000000"}]}', /share a row but differ/],
    ['{"migrations":[{"local":"20260101000000","remote":"20260101000000"},{"local":"20260101000000","remote":""}]}', /duplicate version/],
    ['{"migrations":[{"local":5,"remote":""}]}', /must be strings/],
    ["[1,2,3]", /no JSON object/],
    ['{"migrations": [', /no JSON object|not valid JSON/],
  ];
  for (const [input, message] of bad) {
    assert.throws(() => parseMigrationList(input), (error) => error instanceof MalformedInputError && message.test(error.message), `input: ${input}`);
  }
});

test("log lines around the JSON (merged stderr) do not break parsing", () => {
  const noisy = `Initialising login role...\nConnecting to remote database...\n${list(row("20260729000000"))}\nA new version is available`;
  assert.equal(parseMigrationList(noisy).length, 1);
  assert.deepEqual(parseCliJson('x {"a":1} y'), { a: 1 });
});

test("the dry run and the list must agree", () => {
  const r = run([row("20261007090007"), row("20261008090001", "")]);
  const agree = parseDryRun(JSON.stringify({ upToDate: false, migrations: ["20261008090001_new_thing.sql"] }));
  assert.deepEqual(crossCheckDryRun(r, agree), []);

  const disagree = parseDryRun(JSON.stringify({ upToDate: false, migrations: ["20261008090009_something_else.sql"] }));
  const problems = crossCheckDryRun(r, disagree);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /would apply \[20261008090009\]/);
  assert.equal(evaluate(r, { dryRunProblems: problems }).exitCode, 1);

  const inconsistent = parseDryRun(JSON.stringify({ upToDate: true, migrations: ["20261008090001_new_thing.sql"] }));
  assert.match(crossCheckDryRun(r, inconsistent).join("\n"), /internally inconsistent/);
});

test("dry-run output that is not shaped as expected is rejected", () => {
  assert.throws(() => parseDryRun('{"migrations":[]}'), /upToDate/);
  assert.throws(() => parseDryRun('{"upToDate":true}'), /migrations/);
  assert.throws(() => parseDryRun('{"upToDate":false,"migrations":["notaversion.sql"]}'), /<version>_<name>/);
});

test("CLI: exit codes 0 / 1 / 2 and stdin input", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-"));
  try {
    const ok = join(dir, "ok.json");
    const drift = join(dir, "drift.json");
    const junk = join(dir, "junk.json");
    writeFileSync(ok, list(row("20260729000000")));
    writeFileSync(drift, list(row("", "20260930100001"), row("20260729000000")));
    writeFileSync(junk, "oops");
    const code = (args, input) => spawnSync(process.execPath, [SCRIPT, ...args], { input, encoding: "utf8" });
    assert.equal(code([ok]).status, 0);
    assert.equal(code([drift]).status, 1);
    assert.match(code([drift]).stdout, /Remote-only migration/);
    assert.equal(code([junk]).status, 2);
    assert.match(code([junk]).stdout, /fail closed/);
    assert.equal(code([]).status, 2);
    assert.equal(code([ok, "--expect", "bogus"]).status, 2);
    assert.equal(code(["-"], list(row("20260729000000"))).status, 0);
    const pendingFile = join(dir, "pending.json");
    writeFileSync(pendingFile, list(row("20260729000000"), row("20261008090001", "")));
    assert.equal(code([pendingFile]).status, 0);
    assert.equal(code([pendingFile, "--expect", "up-to-date"]).status, 1);
    const dry = join(dir, "dry.json");
    writeFileSync(dry, JSON.stringify({ upToDate: false, migrations: ["20261008090001_x.sql"] }));
    assert.equal(code([pendingFile, "--dry-run", dry]).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
