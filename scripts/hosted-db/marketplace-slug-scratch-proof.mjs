#!/usr/bin/env node
/**
 * Scratch proof for the plans `marketplace-slug` (Acceptance 244 -> 246, slug + stock-notify) and `prod-marketplace-v2` (Production 237 -> 246, nine migrations).
 * Touches ONLY a THROWAWAY database (mslug_scratch) that it creates inside a local Supabase container (default supabase_db_aladdin_r2_rc2_fresh,
 * SCRATCH_CONTAINER) from a pg_dump of that container's own database and drops again at the end. The container's own database is never written.
 * It never connects to a hosted database and needs no secret. Each migration file runs in its own transaction, like `supabase db push`.
 *   node scripts/hosted-db/marketplace-slug-scratch-proof.mjs [--out <dir>] [--measure] [--keep]
 * One database walks through the states of both plans:
 *   base    Production today (237, latest 20261122090002): the container's missing migrations replayed
 *   v2      + the seven marketplace-v2 migrations = Acceptance today (244, latest 20261123160002)
 *   slug    + 20261124090001 (245). Seeds 4 organizations first (replica role, throwaway only) to MEASURE the data effect.
 *   stock   + 20261124120001 (stock notifications localized) = both plans' target (246). A stock template edit using {product_name} is seeded first: it must survive untouched.
 *   neg     a dependent function is added: the slug forward-fix MUST refuse (RAISE) and change nothing; the stock-notify forward-fix must refuse an edit that uses product_name_en
 *   fixS    the stock-notify forward-fix applied to `stock`: must equal `slug` exactly (catalog) and the default texts must be the old ones, edits untouched
 *   fix1    then the forward-fix marketplace-slug-remove.sql: must equal `v2` exactly, and no organizations.slug changes (data is not reverted)
 *   final   both migrations re-applied, then the combined Production forward-fix ORDER: stock-notify, slug, then marketplace-v2: must equal `base`
 *           except the enum value 'marketplace' PostgreSQL cannot remove
 * Checks: v2 -> slug is exactly PLANS["marketplace-slug"].changed; base -> slug is exactly PLANS["prod-marketplace-v2"].changed. --measure only prints the
 * measured differences (used to write those lists in acceptance-gate.mjs) and skips the two expectation checks.
 */
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PLANS, FORWARD_FIX } from "./acceptance-gate.mjs";

const C = process.env.SCRATCH_CONTAINER || "supabase_db_aladdin_r2_rc2_fresh";
const DB = "mslug_scratch";
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const argv = process.argv.slice(2);
const measure = argv.includes("--measure");
const outDir = argv.includes("--out") ? resolve(argv[argv.indexOf("--out") + 1]) : null;
const V2 = PLANS["marketplace-v2"], SLUG_V = "20261124090001", STOCK_V = "20261124120001";
const dir = join(repo, "supabase/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const v = (f) => f.slice(0, 14);
const slugFile = files.find((f) => v(f) === SLUG_V);
if (!slugFile) throw new Error(`migration ${SLUG_V} is not in this checkout`);
const stockFile = files.find((f) => v(f) === STOCK_V);
if (!stockFile) throw new Error(`migration ${STOCK_V} is not in this checkout`);
const fp = readFileSync(join(here, "catalog-fingerprint.sql"), "utf8");
const strip = (t) => t.replace(/^\s*(begin|commit)\s*;\s*$/gim, "");
const tx = (t) => `begin;\n${strip(t)}\ncommit;\n`;
const run = (args, okStatus = [0]) => { const r = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, MSYS_NO_PATHCONV: "1" } }); if (!okStatus.includes(r.status)) throw new Error(`docker ${args.slice(0, 3).join(" ")} failed: ${r.stderr || r.stdout}`); return r; };
const sh = (...a) => run(["exec", C, ...a]).stdout;
const tmp = mkdtempSync(join(tmpdir(), "mslug-proof-"));
let n = 0;
const psqlFile = (text, okStatus = [0]) => { const f = join(tmp, `s${n++}.sql`); writeFileSync(f, text); run(["cp", f, `${C}:/tmp/mslug_run.sql`]); return run(["exec", C, "psql", "-U", "supabase_admin", "-d", DB, "-X", "-v", "ON_ERROR_STOP=1", "-f", "/tmp/mslug_run.sql"], okStatus); };
const state = (name) => { psqlFile(`\\t on\n\\a\n\\o /tmp/mslug_${name}.json\n${fp}\n\\o\n\\t off\n`); run(["cp", `${C}:/tmp/mslug_${name}.json`, join(tmp, `${name}.json`)]); };
const slugs = (name) => { psqlFile(`\\t on\n\\a\n\\o /tmp/mslug_${name}.json\nselect coalesce(jsonb_agg(jsonb_build_object('name', name, 'name_en', name_en, 'slug', slug) order by created_by, name), '[]'::jsonb) from public.organizations where created_by = '00000000-0000-4000-8000-0000000051f6';\n\\o\n\\t off\n`); run(["cp", `${C}:/tmp/mslug_${name}.json`, join(tmp, `${name}.json`)]); return JSON.parse(readFileSync(join(tmp, `${name}.json`), "utf8")); };
const cd = (a, b, ...extra) => spawnSync("node", [join(here, "catalog-diff.mjs"), join(tmp, `${a}.json`), join(tmp, `${b}.json`), ...extra], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const lines = (r) => r.stdout.trim().split("\n").filter(Boolean).filter((l) => l !== "no catalog differences");
let ok = true;
const check = (pass, text) => { console.log(`${pass ? "PASS" : "FAIL"}  ${text}`); if (!pass) ok = false; };

function createScratch() {
  sh("psql", "-U", "supabase_admin", "-d", "postgres", "-Atc", `drop database if exists ${DB}`);
  sh("psql", "-U", "supabase_admin", "-d", "postgres", "-Atc", `create database ${DB} template template0`);
  sh("sh", "-c", `pg_dump -U supabase_admin -Fc postgres > /tmp/mslug.dump && pg_restore -U supabase_admin -d ${DB} /tmp/mslug.dump 2>&1 | grep -E '^pg_restore: error' | head -5; true`);
}
createScratch();
try {
  const present = sh("psql", "-U", "supabase_admin", "-d", DB, "-Atc", "select string_agg(version, ',') from supabase_migrations.schema_migrations").trim().split(",");
  const missingPre = files.map(v).filter((x) => x <= PLANS["prod-catchup"].postContract && !present.includes(x) && x >= (process.env.SCRATCH_FROM || "20261110090001"));
  const already = [...V2.pending, SLUG_V, STOCK_V].filter((x) => present.includes(x));
  if (already.length) throw new Error(`container ${C} already has ${already.join(", ")}; pick a container at or below 20261122090002 (SCRATCH_CONTAINER)`);
  const t0 = Date.now();
  psqlFile("\\timing off\n" + files.filter((f) => missingPre.includes(v(f))).map((f) => tx(readFileSync(join(dir, f), "utf8"))).join("\n"));
  state("base");
  psqlFile(files.filter((f) => V2.pending.includes(v(f))).map((f) => tx(readFileSync(join(dir, f), "utf8"))).join("\n"));
  state("v2");
  // data effect: 4 organizations, seeded with the replica role (throwaway database only) so no FK or guard trigger is needed
  psqlFile(`set session_replication_role = replica;
insert into public.organizations (id, name, name_en, slug, org_type, created_by) values
  ('00000000-0000-4000-8000-0000000051a1', 'Nile Showroom', 'Nile Showroom!', null, 'showroom_dealer', '00000000-0000-4000-8000-0000000051f6'),
  ('00000000-0000-4000-8000-0000000051a2', 'معرض النيل', null, null, 'showroom_dealer', '00000000-0000-4000-8000-0000000051f6'),
  ('00000000-0000-4000-8000-0000000051a3', 'Has Slug', null, 'keep-me', 'showroom_dealer', '00000000-0000-4000-8000-0000000051f6'),
  ('00000000-0000-4000-8000-0000000051a4', 'Pending Seller', null, null, 'showroom_dealer', '00000000-0000-4000-8000-0000000051f6');
insert into public.marketplace_seller_accounts (organization_id, status, approved_at) values
  ('00000000-0000-4000-8000-0000000051a1', 'approved', now()), ('00000000-0000-4000-8000-0000000051a2', 'approved', now()),
  ('00000000-0000-4000-8000-0000000051a3', 'approved', now()), ('00000000-0000-4000-8000-0000000051a4', 'pending', null);
`);
  const before = slugs("slugs_before");
  psqlFile(tx(readFileSync(join(dir, slugFile), "utf8")));
  state("slug");
  const fnMd5 = () => sh("psql", "-U", "supabase_admin", "-d", DB, "-Atc", "select md5(replace(pg_get_functiondef('app.marketplace_stock_notify()'::regprocedure), E'\r', ''))").trim(); // line endings normalized: a definition applied from a CRLF checkout differs only there
  const fnMd5Pre = fnMd5();
  const after = slugs("slugs_after");
  console.log(`replayed ${missingPre.length} base + ${V2.pending.length} marketplace-v2 + the slug migration, one transaction per file, in the throwaway database ${DB}; wall ${((Date.now() - t0) / 1000).toFixed(1)}s, no error`);
  console.log("data effect (4 seeded organizations, name -> slug before => after):");
  for (let i = 0; i < before.length; i++) console.log(`  ${before[i].name_en ?? before[i].name}: ${before[i].slug ?? "null"} => ${after[i].slug ?? "null"}`);
  const bySlug = (o) => Object.fromEntries(o.map((r) => [r.name, r.slug]));
  const A = bySlug(after);
  check(A["Nile Showroom"] === "nile-showroom" && /^showroom-[0-9a-f]{8}$/.test(A["معرض النيل"] ?? "") && A["Has Slug"] === "keep-me" && A["Pending Seller"] === null,
    "backfill: approved sellers without a slug got one (ASCII name -> name slug, Arabic-only -> showroom-<8 hex>), an existing slug is untouched, a pending seller is untouched");

  // 245 -> 246: the stock-notify migration. Seed the data it must NOT touch: an admin-edited stock template (using {product_name}) and its version.
  const tplFacts = (name) => { psqlFile(`\\t on\n\\a\n\\o /tmp/mslug_${name}.json\nselect coalesce(jsonb_agg(jsonb_build_object('key', key, 'variables', variables, 'default_body_ar', default_body_ar, 'default_body_en', default_body_en, 'title_ar', title_ar, 'body_ar', body_ar, 'title_en', title_en, 'body_en', body_en, 'version', version) order by key), '[]'::jsonb) from public.notification_templates where key like 'marketplace.stock.%';\n\\o\n\\t off\n`); run(["cp", `${C}:/tmp/mslug_${name}.json`, join(tmp, `${name}.json`)]); return JSON.parse(readFileSync(join(tmp, `${name}.json`), "utf8")); };
  psqlFile("update public.notification_templates set title_ar = 't', body_ar = 'b {product_name}', title_en = 't', body_en = 'b {product_name}', version = 7 where key = 'marketplace.stock.low';");
  const tplBefore = tplFacts("tpl_before");
  psqlFile(tx(readFileSync(join(dir, stockFile), "utf8")));
  state("stock");
  const tplAfter = tplFacts("tpl_after");
  const lowB = tplBefore.find((t) => t.key === "marketplace.stock.low"), lowA = tplAfter.find((t) => t.key === "marketplace.stock.low"), outA = tplAfter.find((t) => t.key === "marketplace.stock.out");
  check(lowA.body_en === "b {product_name}" && lowA.title_ar === "t" && lowA.version === 7 && lowA.body_ar === lowB.body_ar, "stock migration: the admin-edited stock template (override columns, version) is untouched");
  check(lowA.default_body_en.includes("{product_name_en}") && lowA.default_body_ar.includes("{product_name_ar}") && outA.default_body_en.includes("{product_name_en}") && outA.default_body_ar.includes("{product_name_ar}"), "stock migration: both templates' default texts use the per-language names");
  check(["product_name", "product_name_ar", "product_name_en"].every((x) => lowA.variables.includes(x) && outA.variables.includes(x)), "stock migration: `variables` declares product_name, product_name_ar and product_name_en on both templates");
  check(outA.version === 1 && outA.title_ar === null, "stock migration: the unedited template keeps version 1 and no override");

  // 1. Acceptance plan: v2 -> stock (slug + stock-notify)
  const acc = cd("v2", "stock");
  const accLines = lines(acc);
  console.log(`\nAcceptance (244 -> 246) catalog differences (${accLines.length}):\n  ${accLines.join("\n  ")}`);
  // 2. Production plan: base -> slug
  const prodLines = lines(cd("base", "stock"));
  const slugOnly = accLines.map((l) => l.replace(/^\w+\s+/, ""));
  console.log(`\nProduction (237 -> 246) catalog differences: ${prodLines.length} (the 7 marketplace-v2 ones + the ${accLines.length} above)`);
  if (measure) console.log(`MEASURED keys v2 -> stock (slug + stock-notify): ${JSON.stringify(slugOnly)}`);
  else {
    const a = cd("v2", "stock", "--expect-changed", PLANS["marketplace-slug"].changed.join(";"));
    check(a.status === 0, `v2 -> stock is exactly PLANS["marketplace-slug"].changed: ${a.status === 0 ? a.stdout.trim().split("\n").at(-1) : a.stderr + a.stdout}`);
    const b = cd("base", "stock", "--expect-changed", PLANS["prod-marketplace-v2"].changed.join(";"));
    check(b.status === 0, `base -> stock is exactly PLANS["prod-marketplace-v2"].changed: ${b.status === 0 ? b.stdout.trim().split("\n").at(-1) : b.stderr + b.stdout}`);
  }

  // 3. the forward-fix must REFUSE, and change nothing, when a dependent exists
  const F = FORWARD_FIX["marketplace-slug"];
  const fixText = readFileSync(join(here, F.file), "utf8");
  psqlFile("create function public.zz_slug_dependent() returns text language sql as $$ select app.marketplace_assign_org_slug(null) $$;");
  const refused = psqlFile(fixText, [3]);
  check(/marketplace-slug forward-fix refused: function body of public\.zz_slug_dependent mentions a slug function/.test(refused.stderr), "forward-fix refuses (RAISE) while another function mentions a slug function");
  psqlFile("drop function public.zz_slug_dependent();");
  psqlFile("create trigger zz_extra after insert on public.marketplace_seller_accounts for each row execute function app.marketplace_seller_slug_trigger();");
  const refused2 = psqlFile(fixText, [3]);
  check(/refused: 1 other trigger\(s\) run the slug functions/.test(refused2.stderr), "forward-fix refuses (RAISE) while another trigger runs a slug function");
  psqlFile("drop trigger zz_extra on public.marketplace_seller_accounts;");
  state("neg");
  const neg = lines(cd("stock", "neg"));
  check(neg.length === 0, `after both refusals the catalog is identical to the stock state (${neg.length ? neg.join(" | ") : "no differences"})`);

  // 3b. the stock-notify forward-fix must REFUSE an admin edit that uses product_name_en, and change nothing
  const FS = FORWARD_FIX["marketplace-stock-notify"];
  const stockFix = readFileSync(join(here, FS.file), "utf8");
  psqlFile("update public.notification_templates set title_ar = 't', body_ar = 'b {product_name_ar}', title_en = 't', body_en = 'b {product_name_en}' where key = 'marketplace.stock.out';");
  const refusedS = psqlFile(stockFix, [3]);
  check(/marketplace-stock-notify forward-fix refused: 1 stock template\(s\) were edited to use product_name_ar/.test(refusedS.stderr), "stock-notify forward-fix refuses (RAISE) while an edit uses product_name_ar / product_name_en");
  state("negS");
  const negS = lines(cd("stock", "negS"));
  const tplNegS = tplFacts("tpl_negS");
  check(negS.length === 0 && JSON.stringify(tplNegS.find((t) => t.key === "marketplace.stock.out").default_body_en) === JSON.stringify(outA.default_body_en), "after the refusal the catalog and the default texts are unchanged");
  psqlFile("update public.notification_templates set title_ar = null, body_ar = null, title_en = null, body_en = null where key = 'marketplace.stock.out';");

  // 4a. the stock-notify forward-fix on the 246 state: back to the 245 catalog and the old default texts, the edit and its version untouched
  psqlFile(tx(stockFix));
  state("fixS");
  const dS = lines(cd("slug", "fixS"));
  check(dS.length === 0, `stock-notify forward-fix: stock -> fixS equals the 245 (slug) catalog exactly (${dS.length ? dS.join(" | ") : "no catalog differences"})`);
  const tplFix = tplFacts("tpl_fix");
  const col = (t, ...c) => JSON.stringify(c.map((k) => t[k]));
  check(tplBefore.every((b) => { const a = tplFix.find((t) => t.key === b.key); return col(a, "variables", "default_body_ar", "default_body_en") === col(b, "variables", "default_body_ar", "default_body_en"); }), "stock-notify forward-fix: variables and default texts of both templates are exactly the pre-plan values");
  check(tplFix.find((t) => t.key === "marketplace.stock.low").version === 7 && tplFix.find((t) => t.key === "marketplace.stock.low").body_en === "b {product_name}", "stock-notify forward-fix: the admin edit and its version are untouched");
  const fnMd5Fixed = fnMd5();
  check(fnMd5Fixed === fnMd5Pre, `stock-notify forward-fix: md5 of pg_get_functiondef (line endings normalized) equals the pre-plan function (${fnMd5Fixed})`);
  psqlFile("update public.notification_templates set title_ar = null, body_ar = null, title_en = null, body_en = null where key = 'marketplace.stock.low';"); // drop the seeded edit: the marketplace-v2 forward-fix refuses edited stock templates by design

  // 4. the slug forward-fix on the Acceptance state: back to v2, data kept
  psqlFile(tx(fixText));
  state("fix1");
  const fixed = slugs("slugs_fix1");
  const d1 = lines(cd("v2", "fix1"));
  check(d1.length === 0, `Acceptance forward-fix: slug -> fix1 equals the 244 state exactly (${d1.length ? d1.join(" | ") : "no catalog differences"})`);
  check(JSON.stringify(fixed) === JSON.stringify(after), "backfilled slugs are NOT reverted (data stays), as documented");

  // 5. re-apply both migrations, then the combined Production forward-fix order: stock-notify, slug, then marketplace-v2
  psqlFile(tx(readFileSync(join(dir, slugFile), "utf8")));
  psqlFile(tx(readFileSync(join(dir, stockFile), "utf8")));
  state("reapplied");
  const d2 = lines(cd("stock", "reapplied"));
  check(d2.length === 0, `re-applying both migrations after the forward-fixes restores the 246 catalog exactly (${d2.length ? d2.join(" | ") : "no differences"})`);
  psqlFile(tx(stockFix));
  psqlFile(tx(fixText));
  const F2 = FORWARD_FIX["marketplace-v2"];
  psqlFile(tx(readFileSync(join(here, F2.file), "utf8")));
  state("final");
  const d3 = lines(cd("base", "final"));
  const residual = d3.filter((l) => !/^changed\s+types: public\.media_video_scope$/.test(l));
  check(residual.length === 0, `Production forward-fix order stock-notify, slug, then marketplace-v2: base -> final differs only by the enum value (${d3.join(" | ") || "no differences"})`);
  if (outDir) { mkdirSync(outDir, { recursive: true }); for (const f of readdirSync(tmp).filter((x) => x.endsWith(".json"))) writeFileSync(join(outDir, f), readFileSync(join(tmp, f))); }
  console.log(`\nMARKETPLACE SLUG SCRATCH PROOF: ${ok ? "OK" : "FAILED"}`);
} finally {
  if (!argv.includes("--keep")) sh("psql", "-U", "supabase_admin", "-d", "postgres", "-Atc", `drop database if exists ${DB}`);
  console.log(`throwaway database ${DB} ${argv.includes("--keep") ? "kept (drop it yourself)" : "dropped"}; the container's own database was never written`);
}
process.exit(ok ? 0 : 1);
