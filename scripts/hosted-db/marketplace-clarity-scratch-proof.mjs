#!/usr/bin/env node
/**
 * Scratch proof for the Acceptance plan `marketplace-clarity`. Touches ONLY throwaway databases (mc_base, mc_run) that it creates inside a local Supabase
 * container (SCRATCH_CONTAINER, default supabase_db_aladdin_conc) from a pg_dump of that container's own database, and drops again at the end. The container's
 * own database is never written; it must hold exactly the migrations Acceptance has (`supabase db reset --version 20261126120002 --no-seed`). It never
 * connects to a hosted database and needs no secret. Each migration file runs in its own transaction, like `supabase db push`.
 *   node scripts/hosted-db/marketplace-clarity-scratch-proof.mjs [--print-changed]
 * (1) snapshots the catalog (catalog-fingerprint.sql), every row and every function ACL, (2) applies the plan's pending migrations, (3) checks the catalog
 * diff is exactly PLANS["marketplace-clarity"].changed and the post smoke passes, (4) runs the pinned forward-fix and compares everything with the pre-state,
 * (5) repeats (4) from the partly applied state, (6) proves the forward-fix refuses, changing nothing, once the new behaviour has written data.
 */
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PLANS, FORWARD_FIX } from "./acceptance-gate.mjs";
import { load, diff, checkExpected } from "./catalog-diff.mjs";
import { judgeFacts, parseFacts } from "./marketplace-clarity-smoke.mjs";

const C = process.env.SCRATCH_CONTAINER || "supabase_db_aladdin_conc";
const BASE = "mc_base", RUN = "mc_run";
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const P = PLANS["marketplace-clarity"];
const argv = process.argv.slice(2);
const dir = join(repo, "supabase/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().filter((f) => P.pending.includes(f.slice(0, 14)));
const fingerprint = readFileSync(join(here, "catalog-fingerprint.sql"), "utf8");
const fix = readFileSync(join(here, FORWARD_FIX["marketplace-clarity"].file), "utf8");
const smoke = readFileSync(join(here, "marketplace-clarity-smoke.sql"), "utf8");

const docker = (args, input) => spawnSync("docker", args, { input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const psql = (db, sql) => {
  const r = docker(["exec", "-i", C, "psql", "-X", "-qAt", "-U", "supabase_admin", "-d", db, "-v", "ON_ERROR_STOP=1"], sql);
  return { ok: r.status === 0, out: r.stdout.trim(), err: r.stderr };
};
const must = (db, sql) => { const r = psql(db, sql); if (!r.ok) throw new Error(`${db}: ${r.err}`); return r.out; };
const apply = (db, f) => must(db, `begin;\n${readFileSync(join(dir, f), "utf8")}\ncommit;\n`);
const clone = (from, to) => { must("postgres", `drop database if exists ${to};`); must("postgres", `create database ${to} template ${from};`); };

/** Everything the forward-fix must give back. */
function snapshot(db) {
  const tables = must(db, "select n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'app', 'storage') and c.relkind = 'r' order by 1;").split("\n");
  const rows = Object.fromEntries(must(db, tables.map((t) =>
    `select '${t}|' || count(*) || '|' || coalesce(md5(string_agg((to_jsonb(x) - 'updated_at')::text, ',' order by (to_jsonb(x) - 'updated_at')::text)), '') from ${t} x;`).join("\n"))
    .split("\n").map((l) => { const [t, ...v] = l.split("|"); return [t, v.join("|")]; }));
  const acl = JSON.parse(must(db, "select coalesce(jsonb_object_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', coalesce((select string_agg(x::text, ',' order by x::text) from unnest(p.proacl) x), 'default') || '/' || coalesce(obj_description(p.oid, 'pg_proc'), '')), '{}') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app');"));
  return { catalog: load(must(db, fingerprint)), rows, acl };
}
function compare(pre, now) {
  const p = diff(pre.catalog, now.catalog).lines;
  for (const t of new Set([...Object.keys(pre.rows), ...Object.keys(now.rows)])) if (pre.rows[t] !== now.rows[t]) p.push(`rows differ: ${t} ${pre.rows[t]} -> ${now.rows[t]}`);
  for (const f of new Set([...Object.keys(pre.acl), ...Object.keys(now.acl)])) if (pre.acl[f] !== now.acl[f]) p.push(`grants or comment differ: ${f} ${pre.acl[f]} -> ${now.acl[f]}`);
  return p;
}

/** The smoke facts of a scratch database. A scratch replay records no migration history, so those two facts are supplied. */
function facts(db, applied, latest) {
  const f = parseFacts(must(db, smoke));
  return { ...f, applied_migrations: applied, latest_migration: latest };
}

let ok = true;
const report = (name, problems) => { if (problems.length) ok = false; console.log(`${problems.length ? "FAIL" : "ok  "} ${name}${problems.length ? `\n     ${problems.slice(0, 40).join("\n     ")}` : ""}`); };
const judged = (phase, f) => { const r = judgeFacts(phase, f); return r.ok ? [] : r.lines.filter((l) => l.startsWith("FAIL")); };
try {
  const have = must("postgres", "select count(*) || '|' || max(version) from supabase_migrations.schema_migrations;");
  if (have !== `${P.applied}|${P.latest}`) throw new Error(`container ${C} is at ${have}; it must be at ${P.applied}|${P.latest}`);
  if (files.length !== P.pending.length) throw new Error("a pending migration file is missing from this checkout");
  must("postgres", `drop database if exists ${BASE};`);
  must("postgres", `create database ${BASE} template template0;`);
  const dump = docker(["exec", C, "sh", "-c", `pg_dump -U supabase_admin -Fc postgres > /tmp/mc.dump && pg_restore -U supabase_admin -d ${BASE} /tmp/mc.dump 2>&1 | grep -E '^pg_restore: error' | head -5; true`]);
  if (dump.status !== 0 || dump.stdout.trim()) throw new Error(`dump/restore failed: ${dump.stdout}${dump.stderr}`);
  const pre = snapshot(BASE);
  report("pre smoke", judged("pre", facts(BASE, P.applied, P.latest)));

  clone(BASE, RUN);
  for (const f of files) apply(RUN, f);
  const post = load(must(RUN, fingerprint));
  const { touched } = diff(pre.catalog, post);
  if (argv.includes("--print-changed")) {
    const out = [...new Set([...touched.keys()].map((k) => (k.includes("(") ? k.slice(0, k.indexOf("(")) : k)))].sort();
    const tmp = join(mkdtempSync(join(tmpdir(), "mc-proof-")), "changed.json");
    writeFileSync(tmp, JSON.stringify(out));
    console.log(`changed list (${out.length} entries): ${JSON.stringify(out)}`);
  }
  report(`pre -> post: ${touched.size} objects, exactly the plan's list`, checkExpected(touched, P.changed));
  report("post smoke", judged("post", facts(RUN, P.applied + P.pending.length, P.pending.at(-1))));
  const full = psql(RUN, fix);
  report("forward-fix after the full plan gives back the pre-state", full.ok ? compare(pre, snapshot(RUN)) : [full.err]);
  const again = psql(RUN, fix);
  report("running the forward-fix a second time changes nothing", again.ok ? compare(pre, snapshot(RUN)) : [again.err]);

  for (let k = 1; k < files.length; k++) {
    clone(BASE, RUN);
    for (const f of files.slice(0, k)) apply(RUN, f);
    const r = psql(RUN, fix);
    report(`forward-fix after ${k} of ${files.length} (${files[k - 1].slice(0, 14)})`, r.ok ? compare(pre, snapshot(RUN)) : [r.err]);
  }

  const replica = "set session_replication_role = replica; ";
  for (const [name, sql] of [
    ["a refund confirmation timer exists", replica + "insert into public.marketplace_timers (subject_type, subject_id, kind, started_at, expires_at) values ('return', gen_random_uuid(), 'return_refund_confirm', now(), now() + interval '7 days');"],
    ["a new template was edited", "update public.notification_templates set version = 2 where key = 'marketplace.return.shipped';"],
  ]) {
    clone(BASE, RUN);
    for (const f of files) apply(RUN, f);
    must(RUN, sql);
    const before = snapshot(RUN);
    const r = psql(RUN, fix);
    report(`the forward-fix refuses after ${name} and changes nothing`, r.ok ? ["it did not refuse"] : !/forward-fix refused/.test(r.err) ? [r.err] : compare(before, snapshot(RUN)));
  }
} finally {
  if (!argv.includes("--keep")) for (const db of [RUN, BASE]) psql("postgres", `drop database if exists ${db};`);
}
console.log(ok ? "marketplace-clarity scratch proof: OK (throwaway databases dropped; the container's own database was never written)" : "marketplace-clarity scratch proof: FAILED");
process.exit(ok ? 0 : 1);
