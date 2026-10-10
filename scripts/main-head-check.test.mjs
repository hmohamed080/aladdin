import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HeadCheckError, evaluateHead, main, normalizeSha, parseLsRemote } from "./main-head-check.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SHA = "236dd48756e1132bfaaeff55c441287625076f2f";
const NEWER = "b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e";
const ls = (sha, ref = "refs/heads/main") => `${sha}\t${ref}\n`;

function run(argv, lsOutput) {
  const dir = mkdtempSync(join(tmpdir(), "head-"));
  const env = { GITHUB_OUTPUT: join(dir, "out"), GITHUB_STEP_SUMMARY: join(dir, "summary"), GITHUB_ACTIONS: "true" };
  const logs = [];
  const runLsRemote = typeof lsOutput === "function" ? lsOutput : () => lsOutput;
  const code = main(argv, { runLsRemote, log: (l) => logs.push(l), env });
  const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : "");
  const result = { code, logs: logs.join("\n"), output: read("out"), summary: read("summary") };
  rmSync(dir, { recursive: true, force: true });
  return result;
}

test("SHA still current: proceed (current=true) at every stage", () => {
  for (const stage of ["initial", "pre-migrate", "pre-promote"]) {
    const r = run(["--stage", stage, "--sha", SHA], ls(SHA));
    assert.equal(r.code, 0, stage);
    assert.equal(r.output, "current=true\n", stage);
    assert.match(r.logs, /proceeding/);
    assert.equal(r.summary, "", "nothing is reported when current");
  }
});

test("superseded before migration: current=false, with the 'no database write' message", () => {
  const r = run(["--stage", "pre-migrate", "--sha", SHA], ls(NEWER));
  assert.equal(r.code, 0, "an answered 'superseded' is a safe exit, not a failure");
  assert.equal(r.output, "current=false\n");
  assert.match(r.logs, /superseded by a newer main commit/);
  assert.match(r.logs, /before the database migration/);
  assert.match(r.logs, /No migration was run and nothing will be promoted/);
  assert.match(r.summary, /Superseded \(pre-migrate\)/);
  assert.match(r.logs, /::notice title=Superseded \(pre-migrate\)::/);
});

test("superseded after migration: current=false, with the forward-only / promotion-skipped message", () => {
  const r = run(["--stage", "pre-promote", "--sha", SHA], ls(NEWER));
  assert.equal(r.code, 0);
  assert.equal(r.output, "current=false\n");
  for (const phrase of [
    "This commit was superseded after database migration",
    "Database remains forward-only",
    "Application promotion was skipped",
    "The queued deployment for the newer main commit will continue from the forward-compatible schema",
  ]) {
    assert.ok(r.logs.includes(phrase), `missing: ${phrase}`);
  }
  assert.ok(!/rolled back|rolling back/i.test(r.logs), "never suggests rolling the database back");
});

test("the initial stage reports superseded too", () => {
  const r = run(["--stage", "initial", "--sha", SHA], ls(NEWER));
  assert.equal(r.output, "current=false\n");
  assert.match(r.logs, /Superseded: main is now at b1c2d3e4/);
});

test("FULL-SHA comparison: a head that differs only in its last characters is superseded, not 'current'", () => {
  const expected = `${"a".repeat(39)}b`;
  const head = `${"a".repeat(39)}c`;
  assert.equal(run(["--stage", "pre-promote", "--sha", expected], ls(head)).output, "current=false\n");
  // identical first 12 / 39 characters, different tail
  const head2 = `${SHA.slice(0, 12)}${"0".repeat(28)}`;
  assert.notEqual(head2, SHA);
  assert.equal(run(["--stage", "pre-migrate", "--sha", SHA], ls(head2)).output, "current=false\n");
  assert.deepEqual(evaluateHead({ remoteHead: head, expectedSha: expected, stage: "initial" }).current, false);
});

test("a prefix is refused as input, on either side", () => {
  const short = run(["--stage", "initial", "--sha", SHA.slice(0, 12)], ls(SHA));
  assert.equal(short.code, 2);
  assert.equal(short.output, "", "no output is written, so nothing downstream can run");
  assert.match(short.logs, /full 40-character commit SHA/);
  assert.equal(run(["--stage", "initial", "--sha", SHA], ls(SHA.slice(0, 12))).code, 2);
  assert.throws(() => normalizeSha("main", "x"), HeadCheckError);
  assert.throws(() => normalizeSha("", "x"), HeadCheckError);
  assert.throws(() => normalizeSha(undefined, "x"), HeadCheckError);
});

test("case differences are normalised; the comparison is otherwise exact", () => {
  assert.equal(run(["--stage", "initial", "--sha", SHA.toUpperCase()], ls(SHA)).output, "current=true\n");
});

test("fails closed when the remote head cannot be read: exit 2, no output", () => {
  const r = run(["--stage", "pre-migrate", "--sha", SHA], () => {
    throw new Error("fatal: unable to access 'https://github.com/...': Could not resolve host");
  });
  assert.equal(r.code, 2);
  assert.equal(r.output, "", "no 'current' output at all: every write step stays skipped");
  assert.match(r.logs, /Failing closed; nothing is written/);
});

test("malformed or ambiguous ls-remote output fails closed", () => {
  for (const bad of ["", "garbage", ls(SHA, "refs/heads/other"), ls(SHA) + ls(NEWER), `not-a-sha\trefs/heads/main\n`]) {
    const r = run(["--stage", "pre-promote", "--sha", SHA], bad);
    assert.equal(r.code, 2, JSON.stringify(bad));
    assert.equal(r.output, "");
  }
  assert.equal(parseLsRemote(`${NEWER}\trefs/heads/main-old\n${SHA}\trefs/heads/main\n`), SHA, "only the exact refs/heads/main line counts");
});

test("usage errors: unknown stage, missing arguments, stray arguments", () => {
  assert.equal(run(["--stage", "later", "--sha", SHA], ls(SHA)).code, 2);
  assert.equal(run(["--sha", SHA], ls(SHA)).code, 2);
  assert.equal(run(["--stage", "initial"], ls(SHA)).code, 2);
  assert.equal(run(["--stage", "initial", "--sha", SHA, "--force"], ls(SHA)).code, 2);
});

test("CLI end to end against a real git remote (no mocks): current, then superseded", () => {
  const dir = mkdtempSync(join(tmpdir(), "head-git-"));
  try {
    const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" });
    const origin = join(dir, "origin.git");
    const work = join(dir, "work");
    assert.equal(git(dir, "init", "--bare", "--initial-branch=main", origin).status, 0);
    assert.equal(git(dir, "clone", origin, work).status, 0);
    const commit = (msg) => {
      git(work, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", msg);
      git(work, "push", "origin", "HEAD:main");
      return git(work, "rev-parse", "HEAD").stdout.trim();
    };
    const first = commit("first");
    const script = join(here, "main-head-check.mjs");
    const check = (sha) => spawnSync(process.execPath, [script, "--stage", "pre-migrate", "--sha", sha], { cwd: work, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: join(dir, "o") } });
    assert.equal(check(first).status, 0);
    assert.match(readFileSync(join(dir, "o"), "utf8"), /current=true/);
    commit("second");
    const stale = check(first);
    assert.equal(stale.status, 0);
    assert.match(readFileSync(join(dir, "o"), "utf8"), /current=false/);
    assert.match(stale.stdout, /superseded by a newer main commit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
