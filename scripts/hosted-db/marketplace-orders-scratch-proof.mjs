#!/usr/bin/env node
/**
 * Scratch proof for the Acceptance plan `marketplace-orders`. Touches ONLY throwaway databases (mo_base, mo_run) that it creates inside a local Supabase
 * container (SCRATCH_CONTAINER, default supabase_db_aladdin_conc) from a pg_dump of that container's own database, and drops again at the end. The container's
 * own database is never written; it must hold exactly the migrations Acceptance has (`supabase db reset --version 20261124120001 --no-seed`). It never
 * connects to a hosted database and needs no secret. Each migration file runs in its own transaction, like `supabase db push`.
 *   node scripts/hosted-db/marketplace-orders-scratch-proof.mjs [--print-changed] [--quick]
 * (1) adds legacy orders shaped like Acceptance's (every one finished) and snapshots the catalog (catalog-fingerprint.sql), row counts, function ACLs and
 * every pre-existing row (updated_at aside), (2) applies the plan's pending migrations, (3) checks the catalog diff is exactly PLANS["marketplace-orders"].changed,
 * (4) runs the pinned forward-fix and compares everything with the pre-state, (5) repeats (4) from every partly applied state (skipped by --quick),
 * (6) proves the forward-fix refuses, changing nothing, once the new application has written data.
 */
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PLANS, FORWARD_FIX } from "./acceptance-gate.mjs";
import { load, diff, checkExpected } from "./catalog-diff.mjs";

const C = process.env.SCRATCH_CONTAINER || "supabase_db_aladdin_conc";
const BASE = "mo_base", RUN = "mo_run";
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const P = PLANS["marketplace-orders"];
const argv = process.argv.slice(2);
const dir = join(repo, "supabase/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().filter((f) => P.pending.includes(f.slice(0, 14)));
const fingerprint = readFileSync(join(here, "catalog-fingerprint.sql"), "utf8");
const fix = readFileSync(join(here, FORWARD_FIX["marketplace-orders"].file), "utf8");

const docker = (args, input) => spawnSync("docker", args, { input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const psql = (db, sql) => {
  const r = docker(["exec", "-i", C, "psql", "-X", "-qAt", "-U", "supabase_admin", "-d", db, "-v", "ON_ERROR_STOP=1"], sql);
  return { ok: r.status === 0, out: r.stdout.trim(), err: r.stderr };
};
const must = (db, sql) => { const r = psql(db, sql); if (!r.ok) throw new Error(`${db}: ${r.err}`); return r.out; };
const apply = (db, f) => must(db, `begin;\n${readFileSync(join(dir, f), "utf8")}\ncommit;\n`);
const clone = (from, to) => { must("postgres", `drop database if exists ${to};`); must("postgres", `create database ${to} template ${from};`); };

/** Legacy orders in every finished shape Acceptance holds (read 2026-11-26) plus a 100% deposit. Only the parents the migration's own UPDATE re-checks exist
 *  (buyer and organization); other foreign keys and triggers are skipped on purpose. */
const BUYER = "00000000-0000-4000-8000-0000000000b1", SELLER = "00000000-0000-4000-8000-0000000000a1";
const fixtures = `set session_replication_role = replica;
insert into public.users (id) values ('${BUYER}');
insert into public.organizations (id, name, org_type, created_by) values ('${SELLER}', 'Proof Seller', 'showroom_dealer', '${BUYER}');
insert into public.marketplace_orders (checkout_id, idempotency_key, buyer_user_id, seller_organization_id, order_number, status, payment_method, payment_status,
  fulfilment, buyer_name, buyer_phone, subtotal_egp, delivery_fee_egp, total_egp, deposit_percent, deposit_egp, instapay_address, instapay_account_name)
select gen_random_uuid(), 'proof-key-' || n, '${BUYER}', '${SELLER}', 'PROOF-' || n, s, m, p, 'pickup', 'Proof Buyer', '+201000000000', 100, 0, 100,
  d, d, case when m = 'instapay' then 'proof@instapay' end, case when m = 'instapay' then 'Proof Seller' end
from (values (1, 'cancelled', 'cod', 'not_collected', null::int), (2, 'delivered', 'cod', 'collected', null), (3, 'delivered', 'instapay', 'collected', 30),
  (4, 'returned', 'cod', 'not_collected', null), (5, 'delivered', 'instapay', 'collected', 100), (6, 'cancelled', 'instapay', 'refund_due', 30),
  (7, 'cancelled', 'instapay', 'deposit_rejected', 30)) v(n, s, m, p, d);
insert into public.marketplace_order_items (order_id, product_id, variant_id, location_id, sku, name_ar, name_en, selling_unit, unit_price_egp, quantity)
select id, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'SKU-1', 'صنف', 'Item', 'piece', 100, 1 from public.marketplace_orders;
insert into public.marketplace_payment_proofs (order_id, object_key, mime_type, created_by, upload_state, status)
select id, 'proof/' || order_number, 'image/jpeg', buyer_user_id, 'confirmed', case when payment_status = 'collected' then 'accepted' else 'rejected' end
  from public.marketplace_orders where payment_method = 'instapay';
`;

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

let ok = true;
const report = (name, problems) => { if (problems.length) ok = false; console.log(`${problems.length ? "FAIL" : "ok  "} ${name}${problems.length ? `\n     ${problems.slice(0, 20).join("\n     ")}` : ""}`); };
try {
  const have = must("postgres", "select count(*) || '|' || max(version) from supabase_migrations.schema_migrations;");
  if (have !== `${P.applied}|${P.latest}`) throw new Error(`container ${C} is at ${have}; it must be at ${P.applied}|${P.latest}`);
  if (files.length !== P.pending.length) throw new Error("a pending migration file is missing from this checkout");
  must("postgres", `drop database if exists ${BASE};`);
  must("postgres", `create database ${BASE} template template0;`);
  const dump = docker(["exec", C, "sh", "-c", `pg_dump -U supabase_admin -Fc postgres > /tmp/mo.dump && pg_restore -U supabase_admin -d ${BASE} /tmp/mo.dump 2>&1 | grep -E '^pg_restore: error' | head -5; true`]);
  if (dump.status !== 0 || dump.stdout.trim()) throw new Error(`dump/restore failed: ${dump.stdout}${dump.stderr}`);
  must(BASE, fixtures);
  const pre = snapshot(BASE);

  clone(BASE, RUN);
  for (const f of files) apply(RUN, f);
  const { touched } = diff(pre.catalog, load(must(RUN, fingerprint)));
  if (argv.includes("--print-changed")) {
    const post = load(must(RUN, fingerprint));
    const added = Object.keys(post.relations).filter((k) => !(k in pre.catalog.relations));
    const out = new Set();
    for (const k of touched.keys()) {
      if (k.includes("(")) { out.add(k.slice(0, k.indexOf("("))); continue; }
      const t = added.find((r) => k.startsWith(`${r}.`));
      out.add(t ? `${t}.*` : k);
    }
    const tmp = join(mkdtempSync(join(tmpdir(), "mo-proof-")), "changed.json");
    writeFileSync(tmp, JSON.stringify([...out].sort()));
    console.log(`changed list (${out.size} entries) written to ${tmp}`);
  }
  report(`pre -> post: ${touched.size} objects, exactly the plan's list`, checkExpected(touched, P.changed));
  const seeds = must(RUN, "select count(*) from public.marketplace_orders where source = 'legacy' and placed_at = created_at;");
  report("the legacy orders were migrated", seeds === "7" ? [] : [`expected 7 migrated legacy orders, found ${seeds}`]);
  const full = psql(RUN, fix);
  report("forward-fix after the full plan gives back the pre-state", full.ok ? compare(pre, snapshot(RUN)) : [full.err]);

  if (!argv.includes("--quick")) {
    for (let k = 1; k < files.length; k++) {
      clone(BASE, RUN);
      for (const f of files.slice(0, k)) apply(RUN, f);
      const r = psql(RUN, fix);
      report(`forward-fix after ${k} of ${files.length} (${files[k - 1].slice(0, 14)})`, r.ok ? compare(pre, snapshot(RUN)) : [r.err]);
    }
  }

  clone(BASE, RUN);
  for (const f of files) apply(RUN, f);
  for (const [name, sql] of [
    ["an upload limit changed", "update public.upload_limit_settings set hourly_uploads = 60;"],
    ["an item is recorded as returned", "set session_replication_role = replica; update public.marketplace_order_items set quantity_returned = 1;"],
    ["a template edited", "update public.notification_templates set version = 2 where event_type like 'marketplace.return%';"],
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
console.log(ok ? "marketplace-orders scratch proof: OK (throwaway databases dropped; the container's own database was never written)" : "marketplace-orders scratch proof: FAILED");
process.exit(ok ? 0 : 1);
