#!/usr/bin/env node
/**
 * Scratch proof for the Production plan `prod-marketplace-orders` (246 -> 267). Touches ONLY throwaway databases (mpo_base, mpo_run) that it creates inside a local
 * Supabase container (SCRATCH_CONTAINER) from a pg_dump of that container's own database, and drops again at the end. The container's own database is never
 * written; it must hold exactly the migrations Production has (a local stack started with the migrations up to 20261124120001, seed off). It never connects to a
 * hosted database and needs no secret. Like `supabase db push`, all pending files run in ONE session, each in its own transaction and recorded in the migration history.
 *   SCRATCH_CONTAINER=<db container> node scripts/hosted-db/marketplace-orders-prod-scratch-proof.mjs
 * (1) snapshots the catalog (catalog-fingerprint.sql), every row and every function ACL, and judges the "pre" smoke, (2) applies the 21 pending migrations,
 * (3) checks the catalog diff is exactly PLANS["prod-marketplace-orders"].changed and the three "post" smokes pass, (4) runs the pinned forward-fixes in the plan's
 * undo order and compares everything with the pre-state, (5) repeats (4) from every partly applied state (the retest and clarity fixes only once their migrations are applied),
 * (6) proves what happens once the new application has written data: the first fix that refuses changes nothing.
 */
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PLANS, FORWARD_FIX } from "./acceptance-gate.mjs";
import { load, diff, checkExpected } from "./catalog-diff.mjs";
import * as orders from "./marketplace-orders-smoke.mjs";
import * as clarity from "./marketplace-clarity-smoke.mjs";
import * as retest from "./marketplace-retest-smoke.mjs";

const C = process.env.SCRATCH_CONTAINER;
if (!C) { console.error("set SCRATCH_CONTAINER to the local Supabase database container that is at the Production history"); process.exit(2); }
const BASE = "mpo_base", RUN = "mpo_run", NAME = "prod-marketplace-orders";
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const P = PLANS[NAME];
const dir = join(repo, "supabase/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().filter((f) => P.pending.includes(f.slice(0, 14)));
const read = (f) => readFileSync(join(here, f), "utf8");
const fingerprint = read("catalog-fingerprint.sql");
const fixes = P.fixes.map((name) => ({ name, sql: read(FORWARD_FIX[name].file) })); // the plan's undo order
const firstOf = (plan) => files.findIndex((f) => f.startsWith(PLANS[plan].pending[0]));

const docker = (args, input) => spawnSync("docker", args, { input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const psql = (db, sql) => {
  const r = docker(["exec", "-i", C, "psql", "-X", "-qAt", "-U", "supabase_admin", "-d", db, "-v", "ON_ERROR_STOP=1"], sql);
  return { ok: r.status === 0, out: r.stdout.trim(), err: r.stderr };
};
const must = (db, sql) => { const r = psql(db, sql); if (!r.ok) throw new Error(`${db}: ${r.err}`); return r.out; };
const record = (f) => `insert into supabase_migrations.schema_migrations (version) values ('${f.slice(0, 14)}');`;
const apply = (db, list) => must(db, list.map((f) => `begin;\n${readFileSync(join(dir, f), "utf8")}\n;\n${record(f)}\ncommit;\n`).join("\n"));
const clone = (from, to) => { must("postgres", `drop database if exists ${to};`); must("postgres", `create database ${to} template ${from};`); };
/** The forward-fixes that apply to a state holding the first k pending files, in the plan's undo order. */
const fixesFor = (k) => fixes.filter((f) => f.name === "marketplace-orders" || k > firstOf(f.name));
/** Runs them one by one and stops at the first refusal or error, like an operator would. */
function undo(db, list) {
  for (const f of list) { const r = psql(db, f.sql); if (!r.ok) return { ok: false, at: f.name, err: r.err }; }
  return { ok: true };
}

/** Everything the forward-fixes must give back. */
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
const facts = (smoke, name, db) => smoke.parseFacts(must(db, read(`marketplace-${name}-smoke.sql`)));
const judged = (r) => (r.ok ? [] : r.lines.filter((l) => l.startsWith("FAIL")));

let ok = true;
const report = (name, problems) => { if (problems.length) ok = false; console.log(`${problems.length ? "FAIL" : "ok  "} ${name}${problems.length ? `\n     ${problems.slice(0, 40).join("\n     ")}` : ""}`); };
try {
  const have = must("postgres", "select count(*) || '|' || max(version) from supabase_migrations.schema_migrations;");
  if (have !== `${P.applied}|${P.latest}`) throw new Error(`container ${C} is at ${have}; it must be at ${P.applied}|${P.latest}`);
  if (files.length !== P.pending.length) throw new Error("a pending migration file is missing from this checkout");
  must("postgres", `drop database if exists ${BASE};`);
  must("postgres", `create database ${BASE} template template0;`);
  const dump = docker(["exec", C, "sh", "-c", `pg_dump -U supabase_admin -Fc postgres > /tmp/mpo.dump && pg_restore -U supabase_admin -d ${BASE} /tmp/mpo.dump 2>&1 | grep -E '^pg_restore: error' | head -5; true`]);
  if (dump.status !== 0 || dump.stdout.trim()) throw new Error(`dump/restore failed: ${dump.stdout}${dump.stderr}`);
  const pre = snapshot(BASE);
  const preSmoke = orders.judgeFacts("pre", facts(orders, "orders", BASE), NAME);
  report("pre smoke", judged(preSmoke));

  clone(BASE, RUN);
  apply(RUN, files);
  const { touched } = diff(pre.catalog, load(must(RUN, fingerprint)));
  report(`pre -> post (${files.length} files, one session): ${touched.size} objects, exactly the plan's list`, checkExpected(touched, P.changed));
  for (const [name, smoke] of [["orders", orders], ["clarity", clarity], ["retest", retest]]) report(`post smoke (${name})`, judged(smoke.judgeFacts("post", facts(smoke, name, RUN), NAME)));
  const full = undo(RUN, fixes);
  report(`forward-fixes ${P.fixes.join(" then ")} after the full plan give back the pre-state`, full.ok ? compare(pre, snapshot(RUN)) : [`${full.at}: ${full.err}`]);

  for (let k = 1; k < files.length; k++) {
    clone(BASE, RUN);
    apply(RUN, files.slice(0, k));
    const list = fixesFor(k);
    const r = undo(RUN, list);
    report(`forward-fix after ${k} of ${files.length} (${files[k - 1].slice(0, 14)}): ${list.map((f) => f.name).join(" then ")}`, r.ok ? compare(pre, snapshot(RUN)) : [`${r.at}: ${r.err}`]);
  }

  const replica = "set session_replication_role = replica; ";
  for (const [name, sql, stopsAt] of [
    ["a later migration is recorded", "insert into supabase_migrations.schema_migrations (version) values ('20270101000000');", "marketplace-retest"],
    ["a refund confirmation timer exists", replica + "insert into public.marketplace_timers (subject_type, subject_id, kind, started_at, expires_at) values ('return', gen_random_uuid(), 'return_refund_confirm', now(), now() + interval '7 days');", "marketplace-clarity"],
    ["an upload limit changed", "update public.upload_limit_settings set hourly_uploads = 60;", "marketplace-orders"],
    ["an orders-plan template edited", "update public.notification_templates set version = 2 where event_type like 'marketplace.return%' and key not in ('marketplace.return.shipped', 'marketplace.return.complaint_filed', 'marketplace.return.refund_confirm_reminder');", "marketplace-orders"],
  ]) {
    clone(BASE, RUN);
    apply(RUN, files);
    must(RUN, sql);
    // the state right before the refusing fix: every earlier fix of the undo order has run
    const earlier = fixes.slice(0, fixes.findIndex((f) => f.name === stopsAt));
    const first = undo(RUN, earlier);
    const before = snapshot(RUN);
    const r = undo(RUN, fixes.slice(earlier.length));
    report(`after ${name}: ${earlier.length ? `${earlier.map((f) => f.name).join(", ")} runs, then ` : ""}${stopsAt} refuses and changes nothing`,
      !first.ok ? [`${first.at}: ${first.err}`] : r.ok ? ["it did not refuse"] : r.at !== stopsAt || !/forward-fix refused/.test(r.err) ? [`${r.at}: ${r.err}`] : compare(before, snapshot(RUN)));
  }
} finally {
  if (!process.argv.includes("--keep")) for (const db of [RUN, BASE]) psql("postgres", `drop database if exists ${db};`);
}
console.log(ok ? "prod-marketplace-orders scratch proof: OK (throwaway databases dropped; the container's own database was never written)" : "prod-marketplace-orders scratch proof: FAILED");
process.exit(ok ? 0 : 1);
