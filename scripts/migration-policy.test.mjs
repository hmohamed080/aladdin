import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluatePr, findRisks, parseChanges, readMarker, stripSql, versionOf } from "./migration-policy.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, "migration-policy.mjs");
const HISTORICAL = join(here, "..", "supabase", "migrations", "20261007090004_job_canonical_location_and_specialty.sql");

const BASE = ["supabase/migrations/20261007090007_jobs_published_at_integrity.sql"];
const add = (version, sql, name = "change") => ({ change: { status: "A", path: `supabase/migrations/${version}_${name}.sql` }, sql });
const run = (entries, baseFiles = BASE) => {
  const files = new Map(entries.map((e) => [e.change.path, e.sql]));
  return evaluatePr({ changes: entries.map((e) => e.change), baseFiles, readFile: (p) => files.get(p) });
};
const rules = (sql) => findRisks(sql).map((r) => r.rule);

test("an additive migration passes with no failures or warnings", () => {
  const out = run([
    add(
      "20261008090001",
      `create table public.widgets (id uuid primary key, name text);
       alter table public.jobs add column widget_id uuid;
       create or replace function public.widget_list() returns setof public.widgets language sql as $$ select * from public.widgets $$;
       create index ix_widgets_name on public.widgets (name);`,
    ),
  ]);
  assert.deepEqual(out, { failures: [], warnings: [] });
});

test("each destructive shape is flagged", () => {
  assert.deepEqual(rules("drop table public.old_things;"), ["drop-table"]);
  assert.deepEqual(rules("alter table public.jobs drop column legacy;"), ["drop-column"]);
  assert.deepEqual(rules("drop function public.job_cancel(uuid);"), ["drop-function"]);
  assert.deepEqual(rules("drop view if exists public.open_jobs;"), ["drop-view"]);
  assert.deepEqual(rules("drop type public.job_status;"), ["drop-type-schema"]);
  assert.deepEqual(rules("alter table public.jobs rename column title to name;"), ["rename"]);
  assert.deepEqual(rules("alter type public.job_status rename value 'open' to 'live';"), ["rename"]);
  assert.deepEqual(rules("alter table public.jobs rename to postings;"), ["rename"]);
  assert.deepEqual(rules("alter table public.jobs alter column offered_amount type integer;"), ["alter-column-type"]);
  assert.deepEqual(rules("alter table public.jobs alter column offered_amount set data type bigint;"), ["alter-column-type"]);
  assert.deepEqual(rules("truncate public.jobs;"), ["truncate"]);
});

test("safe look-alikes are not flagged", () => {
  assert.deepEqual(rules("alter type public.job_status add value 'paused';"), []);
  assert.deepEqual(rules("alter table public.jobs alter column title set not null;"), []);
  assert.deepEqual(rules("alter table public.jobs alter column type_id set default 1;"), []);
  assert.deepEqual(rules("create or replace function public.f() returns int language sql as $$ select 1 $$;"), []);
});

test("comments and string literals never trigger a rule, and line numbers survive", () => {
  const sql = `-- drop table public.nope;
/* alter table x drop column y; */
select 'drop table public.nope' as note, 'it''s a rename column trap' as t;
drop table public.real;`;
  const risks = findRisks(sql);
  assert.deepEqual(risks.map((r) => r.rule), ["drop-table"]);
  assert.equal(risks[0].line, 4);
  assert.equal(stripSql(sql).split("\n").length, sql.split("\n").length);
});

test("drop-and-recreate of the same function is surfaced as a replaced signature", () => {
  const sql = `drop function public.job_create(uuid, text);
create function public.job_create(p_org uuid, p_title text, p_specialty uuid default null) returns uuid language sql as $$ select p_org $$;`;
  assert.ok(rules(sql).includes("drop-recreate-signature"));
  assert.ok(rules(sql).includes("drop-function"));
  // dropping a function that is NOT recreated is only a plain drop
  assert.ok(!rules("drop function public.gone(uuid);").includes("drop-recreate-signature"));
});

test("the real historical migration 20261007090004 is surfaced (it is not rewritten)", () => {
  const sql = readFileSync(HISTORICAL, "utf8");
  const found = rules(sql);
  assert.ok(found.includes("drop-function"), "its drop function statements are flagged");
  assert.ok(found.includes("drop-recreate-signature"), "its job_create/job_update drop-and-recreate is flagged");
  const names = findRisks(sql).filter((r) => r.rule === "drop-recreate-signature").map((r) => r.text);
  assert.ok(names.some((t) => t.includes("job_create")) && names.some((t) => t.includes("job_update")), names.join(" | "));
  // as a NEW file it would fail the policy without a reviewed marker
  const out = run([{ change: { status: "A", path: "supabase/migrations/20261009090001_x.sql" }, sql }]);
  assert.equal(out.failures.length, 1);
  assert.match(out.failures[0], /expand\/contract/);
  assert.match(out.failures[0], /drop-recreate-signature/);
});

test("a destructive migration passes only with a reviewed marker that has a real reason", () => {
  const body = "drop function public.old_rpc(uuid);";
  const withReason = `-- migration-policy: destructive-reviewed - release N added new_rpc and promoted; nothing calls old_rpc any more\n${body}`;
  const ok = run([add("20261008090001", withReason)]);
  assert.deepEqual(ok.failures, []);
  assert.equal(ok.warnings.length, 1);
  assert.match(ok.warnings[0], /accepted via reviewed marker/);

  const bare = run([add("20261008090001", `-- migration-policy: destructive-reviewed\n${body}`)]);
  assert.equal(bare.failures.length, 1, "keyword without a reason is not enough");
  const short = run([add("20261008090001", `-- migration-policy: destructive-reviewed - ok\n${body}`)]);
  assert.equal(short.failures.length, 1, "a token reason is not enough");
  assert.equal(readMarker("-- migration-policy: out-of-order-reviewed - reconciling history that is already applied\n", "out-of-order"), "reconciling history that is already applied");
});

test("editing, deleting or renaming an applied migration always fails", () => {
  for (const status of ["M", "D", "R", "T"]) {
    const out = evaluatePr({
      changes: [{ status, path: "supabase/migrations/20261007090007_jobs_published_at_integrity.sql" }],
      baseFiles: BASE,
      readFile: () => "",
    });
    assert.equal(out.failures.length, 1, status);
    assert.match(out.failures[0], /immutable history/);
  }
});

test("a new migration older than the newest on the base branch is out of order", () => {
  const out = run([add("20260928090002", "select 1;")]);
  assert.equal(out.failures.length, 1);
  assert.match(out.failures[0], /older than the newest migration already on the base branch \(20261007090007\)/);

  const reviewed = run([add("20260928090002", "-- migration-policy: out-of-order-reviewed - reconciles history that is already applied on staging\nselect 1;")]);
  assert.deepEqual(reviewed.failures, []);
  assert.equal(reviewed.warnings.length, 1);

  assert.deepEqual(run([add("20261008090001", "select 1;")]).failures, []);
});

test("duplicate versions and malformed names fail", () => {
  assert.match(run([add("20261007090007", "select 1;", "again")]).failures[0], /already used/);
  assert.match(run([add("20261008090001", "select 1;"), add("20261008090001", "select 2;", "other")]).failures[0], /already used/);
  const bad = evaluatePr({ changes: [{ status: "A", path: "supabase/migrations/not_a_version.sql" }], baseFiles: BASE, readFile: () => "" });
  assert.match(bad.failures[0], /14-digit-version/);
});

test("non-migration paths in the diff are ignored", () => {
  const out = evaluatePr({ changes: [{ status: "M", path: "supabase/tests/79_x_test.sql" }, { status: "M", path: "README.md" }], baseFiles: BASE, readFile: () => "" });
  assert.deepEqual(out, { failures: [], warnings: [] });
});

test("parsing helpers", () => {
  assert.deepEqual(parseChanges("A\tsupabase/migrations/20261008090001_x.sql\nM\tsupabase/migrations/a b.sql\n\n"), [
    { status: "A", path: "supabase/migrations/20261008090001_x.sql" },
    { status: "M", path: "supabase/migrations/a b.sql" },
  ]);
  assert.equal(versionOf("supabase/migrations/20261008090001_x.sql"), "20261008090001");
  assert.equal(versionOf("x.sql"), null);
});

test("CLI end to end: exit 0 for a safe PR, 1 for a destructive one, 2 for bad usage", () => {
  const dir = mkdtempSync(join(tmpdir(), "policy-"));
  try {
    mkdirSync(join(dir, "supabase", "migrations"), { recursive: true });
    writeFileSync(join(dir, "base.txt"), BASE.join("\n"));
    const run = (file, sql, status = "A") => {
      writeFileSync(join(dir, "supabase", "migrations", file), sql);
      writeFileSync(join(dir, "changes.txt"), `${status}\tsupabase/migrations/${file}\n`);
      return spawnSync(process.execPath, [SCRIPT, "--changes", join(dir, "changes.txt"), "--base-files", join(dir, "base.txt"), "--root", dir], { encoding: "utf8" });
    };
    assert.equal(run("20261008090001_ok.sql", "create table public.t (id int);").status, 0);
    const bad = run("20261008090002_bad.sql", "alter table public.jobs drop column x;");
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /expand\/contract/);
    assert.match(bad.stdout, /review aid, not a proof/);
    assert.equal(run("20261007090007_jobs_published_at_integrity.sql", "x", "M").status, 1);
    assert.equal(spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" }).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
