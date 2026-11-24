import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAcceptance, checkAcceptancePost, checkRecovery, pendingDrift, FORWARD_FIX, RESTORE_VERIFIED_SNAPSHOTS, PRODUCTION_RESTORE_VERIFIED_SNAPSHOTS, PC_LATER, PC_LATER_CHANGED, PLANS, plan } from "./acceptance-gate.mjs";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const hist = (n) => Array.from({ length: n }, (_, i) => ({ local: `2025${1000 + i}000000`, remote: `2025${1000 + i}000000` }));
// 206 filler + the real latest 20261107090006 = 207 applied
const base = () => [...hist(206), { local: "20261107090006", remote: "20261107090006" }];
// history of exactly P.applied versions ending with the plan's real latest one (generic: also covers plans that start at 212)
const appliedFor = (P) => [...hist(P.applied - 1), { local: P.latest, remote: P.latest }];
const list = (name, extra = []) => {
  const P = PLANS[name];
  return { migrations: [...appliedFor(P), ...P.pending.map((v) => ({ local: v, remote: null })), ...extra] };
};
const dry = (v) => ({ dryRun: true, migrations: v.map((x) => `${x}_x.sql`) });
const has = (p, re) => assert.ok(p.some((x) => re.test(x)), JSON.stringify(p));

for (const name of Object.keys(PLANS)) {
  const P = PLANS[name], local = [...P.pending];
  test(`${name}: the expected state passes`, () => assert.deepEqual(checkAcceptance({ target: PLANS[name].target, plan: name, list: list(name), dry: dry(P.pending), localVersions: local }), []));
  test(`${name}: an extra pending file is refused`, () => has(checkAcceptance({ target: PLANS[name].target, plan: name, list: list(name, [{ local: "20261201090001", remote: null }]), dry: dry([...P.pending, "20261201090001"]), localVersions: local }), /pending is/));
  test(`${name}: remote-only drift is refused`, () => has(checkAcceptance({ target: PLANS[name].target, plan: name, list: list(name, [{ local: null, remote: "20261201000000" }]), dry: dry(P.pending), localVersions: local }), /drift/));
  test(`${name}: an out-of-order pending migration (needs --include-all) is refused`, () => {
    const l = list(name); l.migrations.push({ local: "20250101000000", remote: null });
    has(checkAcceptance({ target: PLANS[name].target, plan: name, list: l, dry: dry(P.pending), localVersions: local }), /out-of-order|pending is/);
  });
  test(`${name}: a wrong dry run or non-dry run is refused`, () => {
    has(checkAcceptance({ target: PLANS[name].target, plan: name, list: list(name), dry: dry([...P.pending, "20261201090001"]), localVersions: local }), /dry run would push/);
    has(checkAcceptance({ target: PLANS[name].target, plan: name, list: list(name), dry: { ...dry(P.pending), dryRun: false }, localVersions: local }), /dryRun:true/);
  });
  test(`${name}: a missing migration file in the checkout is refused`, () => has(checkAcceptance({ target: PLANS[name].target, plan: name, list: list(name), dry: dry(P.pending), localVersions: [] }), /not in this checkout/));
  const after = () => ({ migrations: [...appliedFor(P), ...P.pending.map((v) => ({ local: v, remote: v }))] });
  test(`${name}: post-push passes when everything is applied`, () => assert.deepEqual(checkAcceptancePost({ target: PLANS[name].target, plan: name, list: after() }), []));
  test(`${name}: post-push refuses the pre-push state`, () => has(checkAcceptancePost({ target: PLANS[name].target, plan: name, list: list(name) }), /applied after the push|still pending/));
}

test("the old 203-migration / 090003..090006 baseline is refused by every plan", () => {
  const old = { migrations: [...hist(202), { local: "20261107090002", remote: "20261107090002" }, ...["20261107090003", "20261107090004", "20261107090005", "20261107090006"].map((v) => ({ local: v, remote: null }))] };
  for (const name of Object.keys(PLANS)) has(checkAcceptance({ target: PLANS[name].target, plan: name, list: old, dry: dry(PLANS[name].pending), localVersions: PLANS[name].pending }), /applied migrations|latest applied|pending is/);
});
test("the media plan refuses a history where media is already applied", () => {
  has(checkAcceptance({ plan: "media", list: list("m1"), dry: dry(["20261110090002"]), localVersions: ["20261110090001"] }), /applied migrations|latest applied|pending is/);
});
test("the m3a plan starts from the 209-migration state (M1 applied) and refuses the 208 and 210 states", () => {
  assert.deepEqual(PLANS.m3a.pending, ["20261112090001"]);
  assert.equal(PLANS.m3a.applied, 209); assert.equal(PLANS.m3a.latest, "20261110090002");
  assert.equal(PLANS.m3a.preContract, PLANS.m1.postContract);
  const l208 = { migrations: [...base(), { local: "20261110090001", remote: "20261110090001" }, { local: "20261110090002", remote: null }, { local: "20261112090001", remote: null }] };
  has(checkAcceptance({ plan: "m3a", list: l208, dry: dry(["20261110090002", "20261112090001"]), localVersions: ["20261112090001"] }), /applied migrations|pending is|dry run would push/);
  const l210 = { migrations: [...appliedFor(PLANS.m3a), { local: "20261112090001", remote: "20261112090001" }] };
  has(checkAcceptance({ plan: "m3a", list: l210, dry: dry([]), localVersions: ["20261112090001"] }), /applied migrations|latest applied|pending is/);
});
test("m3a may change exactly the four functions of the migration and nothing else", () => {
  assert.deepEqual([...PLANS.m3a.changed].sort(), ["public.admin_user_detail", "public.admin_users_directory", "public.pending_registration_consume", "public.pending_registration_save"]);
});
test("unknown plan is refused", () => assert.throws(() => plan("backup-4"), /unknown plan/));
test("media+m1 is exactly media then m1, and the post contract is the M1 one", () => {
  assert.deepEqual(PLANS["media+m1"].pending, [...PLANS.media.pending, ...PLANS.m1.pending]);
  assert.equal(PLANS["media+m1"].postContract, PLANS.m1.postContract);
  assert.equal(PLANS.m1.preContract, PLANS.media.postContract);
});

const SNAP = "aladdin-acceptance-20261108T094450Z";
const here = (f) => fileURLToPath(new URL("./" + f, import.meta.url));
const sha = (f) => createHash("sha256").update(readFileSync(here(f))).digest("hex");
const allShas = () => Object.fromEntries(Object.entries(FORWARD_FIX).map(([k, v]) => [k, sha(v.file)]));
test("recovery: committed forward-fix files are exactly the pinned ones", () => {
  for (const [k, v] of Object.entries(FORWARD_FIX)) assert.equal(sha(v.file), v.sha256, k);
});
for (const n of Object.keys(PLANS)) {
  // plans with freshBackup (tables are created) are covered by their own tests below
  if (PLANS[n].freshBackup) continue;
  test(`recovery: ${n} needs no backup label when its pinned forward-fix hashes match`, () => assert.deepEqual(checkRecovery({ plan: n, label: "", forwardFixSha256: allShas() }), []));
  test(`recovery: ${n} refuses a missing or altered forward-fix`, () => {
    for (const fx of PLANS[n].fixes) {
      has(checkRecovery({ plan: n, label: "", forwardFixSha256: { ...allShas(), [fx]: undefined } }), /missing or its sha256/);
      has(checkRecovery({ plan: n, label: "", forwardFixSha256: { ...allShas(), [fx]: "0".repeat(64) } }), /differs from the pinned/);
    }
  });
  test(`recovery: ${n} accepts only the pinned snapshot label as an optional reference`, () => {
    assert.deepEqual(checkRecovery({ plan: n, label: SNAP, forwardFixSha256: allShas() }), []);
    has(checkRecovery({ plan: n, label: "aladdin-acceptance-20260101T000000Z", forwardFixSha256: allShas() }), /not a pinned restore-verified/);
  });
}
test("recovery: media+m1 needs both forward-fixes", () => assert.deepEqual(PLANS["media+m1"].fixes, ["media", "m1"]));
test("recovery: the pinned snapshot records the audited coverage", () => {
  assert.deepEqual(RESTORE_VERIFIED_SNAPSHOTS[SNAP], { backupRun: "42468447400", restoreRun: "42469078723", tables: 167, rows: 2584, migrations: 203 });
});
test("recovery: every plan declares forward-fix recovery with pinned fixes", () => {
  for (const n of Object.keys(PLANS)) { assert.equal(plan(n).recovery, "forward-fix"); for (const fx of plan(n).fixes) assert.ok(FORWARD_FIX[fx], fx); }
});
// The media forward-fix is also included byte for byte in the pgTAP helper, and its guard block is embedded verbatim in the test.
test("media forward-fix: the pgTAP helper copy is byte-identical", () => {
  assert.equal(readFileSync(here("../../supabase/tests/helpers/media_forward_fix.inc"), "utf8"), readFileSync(here(FORWARD_FIX.media.file), "utf8"));
});
test("media forward-fix: the guard block in pgTAP test 126 equals the guard in the file", () => {
  const fix = readFileSync(here(FORWARD_FIX.media.file), "utf8");
  const g = fix.match(/^do \$guard\$[\s\S]*?^\$guard\$;/m)?.[0];
  assert.ok(g, "guard block present");
  assert.ok(readFileSync(here("../../supabase/tests/126_media_forward_fix_test.sql"), "utf8").includes(g));
});
test("media forward-fix: data-safety structure (guard first, no BEGIN/COMMIT, no top-level DML, drops only the added function)", () => {
  const fix = readFileSync(here(FORWARD_FIX.media.file), "utf8").split("\n").filter((l) => !l.startsWith("--")).join("\n");
  assert.ok(fix.indexOf("do $guard$") < fix.indexOf("CREATE OR REPLACE FUNCTION"));
  assert.ok(!/^\s*(begin|commit)\s*;/im.test(fix));
  const outside = fix.replace(/\$guard\$[\s\S]*?\$guard\$/g, "").replace(/\$function\$[\s\S]*?\$function\$/g, "");
  assert.ok(!/\b(insert|update|delete|truncate|alter table|drop table)\b/i.test(outside), "no top-level DML or table DDL");
  assert.deepEqual([...outside.matchAll(/drop function ([\w.]+)\(/gi)].map((m) => m[1]), ["public.media_migration_target_key"]);
});

// ---------------------------------------------------------------------------------------------------------------------
// plan "marketplace": 19 migrations (5 verification + 14 Marketplace) on top of Acceptance at 212 / 20261115090001
// ---------------------------------------------------------------------------------------------------------------------
test("marketplace: 14 pending, all newer than the latest applied (plain push), 218 -> 232", () => {
  const P = PLANS.marketplace;
  assert.equal(P.pending.length, 14);
  assert.equal(P.applied + P.pending.length, 232);
  assert.equal(P.applied, 218);
  assert.ok(P.pending.every((v) => v > P.latest));
  assert.deepEqual([...P.pending].sort(), P.pending);
  assert.equal(P.latest, "20261116090001");
  assert.equal(P.preContract, P.latest);
  assert.equal(P.postContract, "20261116100014");
});

test("marketplace: the pending set is exactly the migration files in (20261116090001, 20261116100014] in this checkout, and 232 files end at its post contract", () => {
  const dir = here("../../supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, 14)).sort();
  assert.deepEqual(files.filter((v) => v > PLANS.marketplace.latest && v <= PLANS.marketplace.postContract), PLANS.marketplace.pending);
  assert.equal(files.filter((v) => v <= PLANS.marketplace.postContract).length, PLANS.marketplace.applied + PLANS.marketplace.pending.length);
});

test("marketplace: both permission contracts exist in this checkout", () => {
  for (const v of [PLANS.marketplace.preContract, PLANS.marketplace.postContract]) assert.ok(readFileSync(here(`../../supabase/permissions/${v}.json`), "utf8").length > 1000, v);
});

test("marketplace: the expected-change list names the media functions and constraint the Marketplace re-creates and the Marketplace prefixes, and none of the verification-only objects (already on Acceptance)", () => {
  const c = PLANS.marketplace.changed;
  for (const f of ["public.media_storage_resolve", "app.media_metadata", "public.media_storage_locations.media_storage_locations_namespace_check"]) assert.ok(c.includes(f), f);
  for (const f of ["public.review_approve", "public.review_reject", "app.bv_decide", "app.admin_user_status_tab", "public.admin_initiate_verification",
    "app.showroom_review_guard", "app.craftsman_review_guard", "public.admin_organization_detail", "public.verifications.showroom_review_complete",
    "public.audit_log.ck_audit_action_known", "public.verifications.ck_verifications_reason_required"]) assert.ok(!c.includes(f), "not part of this plan: " + f);
  for (const w of ["public.marketplace_*", "public.ux_marketplace_*", "public.ix_marketplace_*", "public.uq_marketplace_*"]) assert.ok(c.includes(w), w);
  assert.equal(new Set(c).size, c.length);
});

test("marketplace: it needs a fresh restore-verified snapshot (>= 212 migrations); the historical 203 one is refused", () => {
  const shas = allShas();
  has(checkRecovery({ plan: "marketplace", label: "", forwardFixSha256: shas }), /needs --backup-label of a fresh restore-verified snapshot/);
  has(checkRecovery({ plan: "marketplace", label: "aladdin-acceptance-20261108T094450Z", forwardFixSha256: shas }), /has 203 migrations/);
  has(checkRecovery({ plan: "marketplace", label: "aladdin-acceptance-20991231T000000Z", forwardFixSha256: shas }), /not a pinned restore-verified snapshot/);
});

test("marketplace: with a snapshot of 218+ migrations and the forward-fix pinned, recovery passes; a 212-migration one is refused", () => {
  RESTORE_VERIFIED_SNAPSHOTS["aladdin-acceptance-20991231T000000Z"] = { backupRun: "x", restoreRun: "y", tables: 1, rows: 1, migrations: 218 };
  try { assert.deepEqual(checkRecovery({ plan: "marketplace", label: "aladdin-acceptance-20991231T000000Z", forwardFixSha256: allShas() }), []);
    RESTORE_VERIFIED_SNAPSHOTS["aladdin-acceptance-20991231T000000Z"].migrations = 212;
    has(checkRecovery({ plan: "marketplace", label: "aladdin-acceptance-20991231T000000Z", forwardFixSha256: allShas() }), /has 212 migrations/); }
  finally { delete RESTORE_VERIFIED_SNAPSHOTS["aladdin-acceptance-20991231T000000Z"]; }
});

test("marketplace: its only recovery is the pinned marketplace forward-fix (the verification migrations are already applied, no plan reverts them)", () => {
  assert.deepEqual(PLANS.marketplace.fixes, ["marketplace"]);
  for (const fx of PLANS.marketplace.fixes) assert.ok(FORWARD_FIX[fx]?.sha256, fx);
});

test("marketplace forward-fix: one transaction, a data guard that raises before any DROP, and it never deletes user rows", () => {
  const sql = readFileSync(here(FORWARD_FIX.marketplace.file), "utf8");
  const code = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
  assert.match(code, /^begin;/m);
  assert.match(code, /commit;\s*$/);
  assert.ok(code.indexOf("raise exception") > -1 && code.indexOf("raise exception") < code.indexOf("DROP TABLE"), "guard precedes the first DROP");
  assert.match(code, /media_storage_locations where namespace = 'marketplace'/);
  assert.doesNotMatch(code, /\b(truncate|delete\s+from\s+public\.marketplace_)/i);
  // the only DELETEs are the three marketplace admin permission rows (core permissions are locked, so the guard trigger is paused and re-enabled)
  assert.equal((code.match(/delete from/gi) ?? []).length, 2);
  assert.ok(code.indexOf("DISABLE TRIGGER trg_admin_role_permissions_guard") < code.indexOf("delete from public.admin_role_permissions"));
  assert.ok(code.indexOf("ENABLE TRIGGER trg_admin_role_permissions_guard") > code.indexOf("delete from public.admin_role_permissions"));
  assert.ok(code.indexOf("ENABLE TRIGGER trg_admin_role_permissions_guard") < code.indexOf("delete from public.admin_permissions"));
});

// ---------------------------------------------------------------------------------------------------------------------
// plan "media-notify": 20261121090001..003 on top of Acceptance at 232 / 20261116100014
// ---------------------------------------------------------------------------------------------------------------------
test("media-notify: 3 pending, all newer than the latest applied, 232 -> 235, chained after the marketplace plan", () => {
  const P = PLANS["media-notify"];
  assert.deepEqual(P.pending, ["20261121090001", "20261121090002", "20261121090003"]);
  assert.equal(P.applied, PLANS.marketplace.applied + PLANS.marketplace.pending.length);
  assert.equal(P.latest, PLANS.marketplace.postContract);
  assert.equal(P.preContract, P.latest);
  assert.equal(P.postContract, "20261121090003");
  assert.ok(P.pending.every((v) => v > P.latest));
});

test("media-notify: the pending set is exactly the migration files after 20261116100014 in this checkout, until a later plan exists", () => {
  const files = readdirSync(here("../../supabase/migrations")).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, 14)).sort();
  assert.deepEqual(files.filter((v) => v > PLANS["media-notify"].latest && v <= PLANS["media-notify"].postContract), PLANS["media-notify"].pending);
});

test("media-notify: both permission contracts exist in this checkout", () => {
  for (const v of [PLANS["media-notify"].preContract, PLANS["media-notify"].postContract]) assert.ok(readFileSync(here(`../../supabase/permissions/${v}.json`), "utf8").length > 1000, v);
});

test("media-notify: the expected-change list names the four tables by prefix, the 15 functions and the notifications column, and nothing unrelated", () => {
  const c = PLANS["media-notify"].changed;
  for (const w of ["public.media_limits*", "public.media_limit_events*", "public.notification_templates*", "public.notification_template_events*", "public.notifications.content*",
    "public.media_storage_attest", "app.notify_from_template", "public.marketplace_rejected_images_purge", "public.media_videos.media_videos_cap_on_insert"]) assert.ok(c.includes(w), w);
  assert.equal(c.filter((x) => !x.endsWith("*") && /^(app|public)\.[a-z_]+$/.test(x)).length, 15);
  for (const f of ["public.marketplace_*", "public.notifications", "public.profiles*"]) assert.ok(!c.includes(f), "not part of this plan: " + f);
  assert.equal(new Set(c).size, c.length);
});

test("media-notify: it needs a fresh restore-verified snapshot (>= 232 migrations); the 203 and 218 ones are refused", () => {
  const shas = allShas();
  has(checkRecovery({ plan: "media-notify", label: "", forwardFixSha256: shas }), /needs --backup-label of a fresh restore-verified snapshot/);
  has(checkRecovery({ plan: "media-notify", label: "aladdin-acceptance-20261108T094450Z", forwardFixSha256: shas }), /has 203 migrations/);
  has(checkRecovery({ plan: "media-notify", label: "aladdin-acceptance-20261116T152127Z", forwardFixSha256: shas }), /has 218 migrations/);
});

test("media-notify: with a snapshot of 232+ migrations and the forward-fix pinned, recovery passes", () => {
  RESTORE_VERIFIED_SNAPSHOTS["aladdin-acceptance-20991231T000000Z"] = { backupRun: "x", restoreRun: "y", tables: 1, rows: 1, migrations: 232 };
  try { assert.deepEqual(checkRecovery({ plan: "media-notify", label: "aladdin-acceptance-20991231T000000Z", forwardFixSha256: allShas() }), []); }
  finally { delete RESTORE_VERIFIED_SNAPSHOTS["aladdin-acceptance-20991231T000000Z"]; }
});

test("media-notify forward-fix: one transaction, a data guard that raises before any DROP, only permission rows are deleted, grants and limits restored", () => {
  const sql = readFileSync(here(FORWARD_FIX["media-notify"].file), "utf8");
  const code = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
  const outside = code.replace(/\$guard\$[\s\S]*?\$guard\$/g, "").replace(/\$function\$[\s\S]*?\$function\$/g, "");
  assert.match(code, /^begin;/m);
  assert.match(code, /commit;\s*$/);
  assert.ok(code.indexOf("raise exception") > -1 && code.indexOf("raise exception") < code.indexOf("DROP TABLE"), "guard precedes the first DROP");
  assert.doesNotMatch(code, /truncate/i);
  assert.equal((outside.match(/delete from/gi) ?? []).length, 2);
  assert.ok(code.indexOf("DISABLE TRIGGER trg_admin_role_permissions_guard") < code.indexOf("delete from public.admin_role_permissions"));
  assert.ok(code.indexOf("ENABLE TRIGGER trg_admin_role_permissions_guard") > code.indexOf("delete from public.admin_role_permissions"));
  assert.ok(code.indexOf("ENABLE TRIGGER trg_admin_role_permissions_guard") < code.indexOf("delete from public.admin_permissions"));
  assert.match(code, /ADD CONSTRAINT ck_notifications_event_type_known/);
  assert.match(code, /file_size_limit = 5242880/);
  assert.equal((code.match(/drop table/gi) ?? []).length, 4);
});

test("media-notify forward-fix: safe from a partly applied plan - every guarded table or column is checked for existence first", () => {
  const code = readFileSync(here(FORWARD_FIX["media-notify"].file), "utf8").split("\n").filter((l) => !l.startsWith("--")).join("\n");
  const guard = code.slice(code.indexOf("do $guard$"), code.indexOf("$guard$;", code.indexOf("do $guard$")));
  for (const t of ["media_limit_events", "media_limits", "notification_template_events", "notification_templates"]) assert.ok(guard.includes(`to_regclass('public.${t}') is not null`), t);
  assert.match(guard, /information_schema\.columns[^;]*column_name = 'content'/);
  assert.doesNotMatch(code.replace(/\$guard\$[\s\S]*?\$guard\$/g, ""), /drop (table|function|trigger|constraint) (?!if exists)/i);
});

test("verification forward-fix: one transaction, restores both removed guards and their triggers, drops the new function, never touches data", () => {
  // restored function bodies legitimately contain DML; only statements OUTSIDE the dollar-quoted bodies may not touch data
  const code = readFileSync(here(FORWARD_FIX.verification.file), "utf8").split("\n").filter((l) => !l.startsWith("--")).join("\n");
  const outside = code.replace(/\$function\$[\s\S]*?\$function\$/g, "");
  assert.match(code, /^begin;/m);
  assert.match(code, /commit;\s*$/);
  for (const needle of ["app.showroom_review_guard()", "app.craftsman_review_guard()", "CREATE TRIGGER showroom_review_complete", "CREATE TRIGGER craftsman_review_complete",
    "DROP FUNCTION IF EXISTS public.admin_initiate_verification(", "ck_audit_action_known", "ck_verifications_reason_required"]) assert.ok(code.includes(needle), needle);
  assert.doesNotMatch(outside, /\b(insert\s+into|update\s+public|delete\s+from|truncate)\b/i);
});

// ---------------------------------------------------------------------------------------------------------------------
// plan "registration-gate": 20261122090001..002 on top of Acceptance at 235 / 20261121090003 (ADR-0031). Function-only.
// ---------------------------------------------------------------------------------------------------------------------
test("registration-gate: 2 pending, newer than the latest applied, 235 -> 237, chained after the media-notify plan", () => {
  const P = PLANS["registration-gate"];
  assert.deepEqual(P.pending, ["20261122090001", "20261122090002"]);
  assert.equal(P.applied, PLANS["media-notify"].applied + PLANS["media-notify"].pending.length);
  assert.equal(P.latest, PLANS["media-notify"].postContract);
  assert.equal(P.preContract, P.latest);
  assert.equal(P.postContract, "20261122090002");
  assert.ok(P.pending.every((v) => v > P.latest));
});

test("registration-gate: the pending set is exactly the migration files after 20261121090003 in this checkout, until a later plan exists", () => {
  const files = readdirSync(here("../../supabase/migrations")).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, 14)).sort();
  assert.deepEqual(files.filter((v) => v > PLANS["registration-gate"].latest && v <= PLANS["registration-gate"].postContract), PLANS["registration-gate"].pending);
});

test("registration-gate: both permission contracts exist in this checkout", () => {
  for (const v of [PLANS["registration-gate"].preContract, PLANS["registration-gate"].postContract]) assert.ok(readFileSync(here(`../../supabase/permissions/${v}.json`), "utf8").length > 1000, v);
});

test("registration-gate: the expected-change list is exactly the 3 replaced and 2 added functions (measured: 5 function differences, nothing else)", () => {
  assert.deepEqual([...PLANS["registration-gate"].changed].sort(), [
    "app.admin_user_registration_state", "app.admin_user_status_tab", "app.api_pre_request", "app.registration_gate_allows", "public.admin_users_directory",
  ]);
});

test("registration-gate: function-only, so no backup is required; its only recovery is the pinned forward-fix", () => {
  const P = PLANS["registration-gate"];
  assert.ok(!P.freshBackup);
  assert.deepEqual(P.fixes, ["registration-gate"]);
  assert.deepEqual(checkRecovery({ plan: "registration-gate", label: "", forwardFixSha256: allShas() }), []);
  has(checkRecovery({ plan: "registration-gate", label: "", forwardFixSha256: { ...allShas(), "registration-gate": "0".repeat(64) } }), /sha256|forward-fix/i);
});

test("registration-gate forward-fix: one transaction, function-only, replaces the three functions before it drops the two new ones, never touches data", () => {
  const sql = readFileSync(here(FORWARD_FIX["registration-gate"].file), "utf8");
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.equal((code.match(/^begin;/gim) ?? []).length, 1);
  assert.equal((code.match(/^commit;/gim) ?? []).length, 1);
  const at = (needle) => { const i = code.indexOf(needle); assert.ok(i > -1, needle); return i; };
  const lastReplace = Math.max(at("create or replace function app.api_pre_request()"), at("create or replace function app.admin_user_status_tab("), at("CREATE OR REPLACE FUNCTION public.admin_users_directory("));
  assert.ok(lastReplace < at("DROP FUNCTION IF EXISTS app.registration_gate_allows(text, text);"), "replace before drop");
  assert.ok(lastReplace < at("DROP FUNCTION IF EXISTS app.admin_user_registration_state(uuid);"), "replace before drop");
  for (const forbidden of [/\binsert\s+into\b/i, /\bupdate\s+public\./i, /\bdelete\s+from\b/i, /\btruncate\b/i, /\bdrop\s+table\b/i, /\balter\s+table\b/i, /\bgrant\b/i, /\brevoke\b/i, /\bcascade\b/i])
    assert.ok(!forbidden.test(code), String(forbidden));
  // the restored hook no longer references the gate functions it is about to drop
  const hook = code.slice(at("create or replace function app.api_pre_request()"), at("comment on function app.api_pre_request()"));
  assert.ok(!/registration_gate_allows|admin_user_registration_state/.test(hook));
  assert.ok(!/registration_gate_allows|admin_user_registration_state/.test(code.slice(at("CREATE OR REPLACE FUNCTION public.admin_users_directory("), at("DROP FUNCTION IF EXISTS app.registration_gate_allows"))));
});


// plan "prod-catchup": PRODUCTION, the single plan 210 -> 237 (27 migrations 20261114090001 .. 20261122090002) on top of Production at 210 / 20261112090001 (read live 2026-11-23).
const PC = () => PLANS["prod-catchup"];
const PC_FIRST_27 = ["20261114090001", "20261115090001", "20261115090002", "20261115090003", "20261115090004", "20261115090005", "20261115090006", "20261116090001",
  ...Array.from({ length: 14 }, (_, i) => `202611161000${String(i + 1).padStart(2, "0")}`), "20261121090001", "20261121090002", "20261121090003", "20261122090001", "20261122090002"];
test("prod-catchup: targets production, 210 -> 237, exactly the 27 pending versions in order, all newer than the latest applied", () => {
  const P = PC();
  assert.equal(P.target, "production");
  assert.equal(P.applied, 210); assert.equal(P.latest, "20261112090001"); assert.equal(P.preContract, "20261112090001");
  assert.deepEqual(P.pending.slice(0, 27), PC_FIRST_27);
  assert.deepEqual(P.pending, [...PC_FIRST_27, ...PC_LATER]);
  assert.equal(P.postContract, P.pending.at(-1));
  assert.ok(P.pending.every((v, i, a) => v > P.latest && (i === 0 || v > a[i - 1])), "ascending, plain push");
  assert.equal(P.applied + P.pending.length, 237 + PC_LATER.length);
  assert.throws(() => plan("prod-batch1"), /unknown plan/, "the unusable batch plan is gone");
});
test("prod-catchup: every migration on this checkout between the latest applied and the plan's last version is in the plan; both permission contracts exist", () => {
  const P = PC();
  const files = readdirSync(here("../../supabase/migrations")).map((f) => f.slice(0, 14));
  assert.deepEqual(files.filter((v) => v > P.latest && v <= P.pending.at(-1)), P.pending);
  for (const v of [P.preContract, P.postContract]) assert.ok(readFileSync(here(`../../supabase/permissions/${v}.json`)).length > 0, v);
});
test("prod-catchup: pendingDrift names every newer migration the plan does not list and every plan version missing from the checkout", () => {
  const P = PC();
  assert.deepEqual(pendingDrift({ plan: "prod-catchup", localVersions: [...P.pending, "20261112090001"] }), { unplanned: [], missing: [] });
  assert.deepEqual(pendingDrift({ plan: "prod-catchup", localVersions: [...P.pending, "20261123090001", "20261124090002"] }).unplanned, ["20261123090001", "20261124090002"]);
  assert.deepEqual(pendingDrift({ plan: "prod-catchup", localVersions: P.pending.slice(1) }).missing, [P.pending[0]]);
});
test("prod-catchup: PC_LATER is how later migrations (Marketplace PR 5 / PR 6) join the plan, and it is empty or strictly newer than 20261122090002", () => {
  assert.ok(PC_LATER.every((v) => /^\d{14}$/.test(v) && v > "20261122090002"));
  assert.ok(Array.isArray(PC_LATER_CHANGED));
  assert.ok(PC().changed.length >= 184);
});
test("prod-catchup: expected-change list was measured; it names the replaced constraints, the dropped trigger, the 5 non-table added functions and the table prefixes", () => {
  const c = PC().changed;
  for (const k of ["public.audit_log.ck_audit_action_known", "public.verifications.ck_verifications_reason_required", "public.notifications.ck_notifications_event_type_known",
    "public.media_storage_locations.media_storage_locations_namespace_check", "public.verifications.showroom_review_complete", "public.media_videos.media_videos_cap_on_insert",
    "app.registration_gate_allows", "app.admin_user_registration_state", "app.assert_assigned_reviewer", "public.craftsman_profile_verification_submit", "public.admin_initiate_verification",
    "public.marketplace_*", "public.media_limit*", "public.notification_template*", "public.notifications.content*"]) assert.ok(c.includes(k), k);
  assert.equal(new Set(c).size, c.length, "no duplicates");
});
test("prod-catchup: every function the 27 migrations create is covered by the expected-change list (derived from the SQL, not written by hand)", () => {
  const P = PC(), dir = here("../../supabase/migrations");
  const hit = (k) => P.changed.some((e) => (e.endsWith("*") ? k.startsWith(e.slice(0, -1)) : k === e || k.startsWith(e + "(")));
  const miss = [], dropped = new Set(), created = [];
  for (const f of readdirSync(dir).filter((f) => PC_FIRST_27.includes(f.slice(0, 14)))) {
    const sql = readFileSync(`${dir}/${f}`, "utf8").replace(/--.*$/gm, "");
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+((?:public|app)\.[a-z_0-9]+)\s*\(/gi)) created.push([f, m[1].toLowerCase()]);
    for (const m of sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?((?:public|app)\.[a-z_0-9]+)\s*\(/gi)) dropped.add(m[1].toLowerCase());
  }
  // a function created and dropped again inside the sequence leaves no trace (the catalog diff is net)
  for (const [f, n] of created) if (!dropped.has(n) && !hit(n)) miss.push(`${f}: ${n}`);
  assert.deepEqual(miss, []);
});
test("prod-catchup: the Acceptance gate refuses it and the Production gate refuses every Acceptance plan", () => {
  const P = PC();
  has(checkAcceptance({ plan: "prod-catchup", list: list("prod-catchup"), dry: dry(P.pending), localVersions: [...P.pending] }), /targets production, but this gate was run for acceptance/);
  has(checkAcceptancePost({ plan: "prod-catchup", list: { migrations: [...appliedFor(P), ...P.pending.map((v) => ({ local: v, remote: v }))] } }), /targets production/);
  for (const name of Object.keys(PLANS).filter((n) => PLANS[n].target !== "production")) {
    const A = PLANS[name];
    has(checkAcceptance({ target: "production", plan: name, list: list(name), dry: dry(A.pending), localVersions: [...A.pending] }), /targets acceptance, but this gate was run for production/);
  }
});
test("prod-catchup: a push of only part of the pending list or one with an extra migration is refused (a push always sends everything)", () => {
  const P = PC();
  has(checkAcceptance({ target: "production", plan: "prod-catchup", list: list("prod-catchup"), dry: dry(P.pending.slice(0, 2)), localVersions: P.pending }), /dry run would push/);
  has(checkAcceptance({ target: "production", plan: "prod-catchup", list: list("prod-catchup", [{ local: "20261123090001", remote: null }]), dry: dry([...P.pending, "20261123090001"]), localVersions: P.pending }), /pending is|dry run would push/);
});
test("prod-catchup: needs a restore-verified PRODUCTION snapshot; only the pinned one counts (fail closed) and an Acceptance snapshot never counts", () => {
  assert.equal(PC().freshBackup, true);
  assert.deepEqual(PRODUCTION_RESTORE_VERIFIED_SNAPSHOTS, { "aladdin-production-20261123T142725Z": { backupRun: "45194259216", restoreRun: "45199513364", tables: 172, rows: 32355, migrations: 210 } });
  assert.ok(Object.keys(PRODUCTION_RESTORE_VERIFIED_SNAPSHOTS).every((k) => k.startsWith("aladdin-production-")));
  assert.deepEqual(checkRecovery({ plan: "prod-catchup", label: "aladdin-production-20261123T142725Z", forwardFixSha256: allShas() }), []);
  const shas = allShas();
  has(checkRecovery({ plan: "prod-catchup", label: "", forwardFixSha256: shas }), /needs --backup-label/);
  has(checkRecovery({ plan: "prod-catchup", label: Object.keys(RESTORE_VERIFIED_SNAPSHOTS).at(-1), forwardFixSha256: shas }), /not a pinned restore-verified PRODUCTION snapshot/);
  has(checkRecovery({ plan: "prod-catchup", label: "aladdin-production-20261123T000000Z", forwardFixSha256: shas }), /not a pinned restore-verified PRODUCTION snapshot/);
});
test("prod-catchup: recovery is three pinned forward-fixes in undo order (media-notify, marketplace, prod-catchup); a missing or altered one is refused", () => {
  assert.deepEqual(PC().fixes, ["media-notify", "marketplace", "prod-catchup"]);
  for (const fx of PC().fixes) assert.ok(FORWARD_FIX[fx]?.sha256, fx);
  const shas = allShas();
  has(checkRecovery({ plan: "prod-catchup", label: "aladdin-production-x", forwardFixSha256: { ...shas, "prod-catchup": "0".repeat(64) } }), /forward-fix .*prod-catchup-restore-previous.sql/);
  has(checkRecovery({ plan: "prod-catchup", label: "aladdin-production-x", forwardFixSha256: { ...shas, marketplace: undefined } }), /marketplace-remove.sql/);
});
// md5 of pg_get_functiondef read LIVE on Production (kkpkgjrweysgvhvkhzun) on 2026-11-23, read-only SELECT. The forward-fix text, with the trailing newline pg_get_functiondef emits, must hash to these.
const PRODUCTION_DEF_MD5 = {
  "app.showroom_review_guard": "26cc7fa6f659689a06c2afd39055e9c3", "app.showroom_activation_guard": "b2a81ce4db1a2166986043c30e1f9b91",
  "app.admin_user_status_tab": "a4015c3cf935c40dd867bda43b203636", "app.bv_decide": "e2ebf60f07446b71be626f13e99e4fc7", "app.api_pre_request": "b6d0688d65ac8c8c950bd220eb7dfb3a",
  "public.admin_organization_detail": "2fed3ec9bbd63cb10afc39cf0d3f02b5", "public.admin_organizations_list": "61d36eed4c0e27c80abad1b046f405c8",
  "public.admin_user_detail": "cc64ccf105d69630c9753bee678fd846", "public.admin_users_directory": "57f096f2b9ffdb246f0461ab5819b615",
  "public.apply_account_upgrade": "7ac34c470b0bba6b6815df8347bc3dad", "public.apply_organization_verification": "2b5b185a2f447654ce1f501cffacd48a",
  "public.business_verification_request_info": "2efcbb735500279f70d98872c4e67804", "public.review_approve": "a8929887cca8956dec0d2ee986ba0e68", "public.review_reject": "b2adb8e881cd59eac75d7f5ea81dcbc5"
};
test("prod-catchup forward-fix: the 14 restored function definitions hash to the md5 read live on Production (exact restore, not an approximation)", () => {
  const sql = readFileSync(here(`./${FORWARD_FIX["prod-catchup"].file}`), "utf8");
  const got = {};
  for (const m of sql.matchAll(/CREATE OR REPLACE FUNCTION ([a-z_.]+)\([\s\S]*?\$function\$;/g)) got[m[1]] = createHash("md5").update(m[0].slice(0, -1) + "\n").digest("hex");
  assert.deepEqual(got, PRODUCTION_DEF_MD5);
});
test("prod-catchup forward-fix: one transaction, restores before it drops, every drop IF EXISTS, constraints NOT VALID first, owner-only ACL on the guard, no data deleted", () => {
  const sql = readFileSync(here(`./${FORWARD_FIX["prod-catchup"].file}`), "utf8");
  const code = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
  const low = code.toLowerCase();
  const at = (s) => { const i = low.indexOf(s.toLowerCase()); assert.ok(i >= 0, s); return i; };
  assert.equal((code.match(/^begin;$/gm) ?? []).length, 1); assert.ok(code.trimEnd().endsWith("commit;"));
  const lastRestore = Math.max(...Object.keys(PRODUCTION_DEF_MD5).map((n) => low.lastIndexOf(`create or replace function ${n}(`)));
  for (const d of ["drop function if exists app.craftsman_review_guard()", "drop function if exists public.craftsman_profile_verification_submit(boolean)", "drop function if exists public.admin_initiate_verification(text, uuid, text)",
    "drop function if exists app.admin_user_registration_state(uuid)", "drop function if exists app.registration_gate_allows(text, text)", "drop function if exists app.assert_assigned_reviewer(public.verifications)"]) assert.ok(lastRestore < at(d), `restore before ${d}`);
  assert.ok(!/drop function (?!if exists)/i.test(code), "every function drop is IF EXISTS");
  assert.ok(at("revoke all on function app.showroom_review_guard() from public, anon, authenticated, service_role") < at("create trigger showroom_review_complete"));
  assert.ok(/add constraint ck_verifications_reason_required[\s\S]*?not valid;/i.test(code) && /add constraint ck_audit_action_known[\s\S]*?not valid;/i.test(code));
  assert.ok(!/\b(delete|truncate|insert into)\b/i.test(code.replace(/\$function\$[\s\S]*?\$function\$/g, "")), "no row deleted or inserted outside function bodies");
  assert.ok(!/drop table|drop column/i.test(code), "function/constraint/trigger only");
  // comments are restored for the 7 functions that carry one on Production
  assert.equal((code.match(/^COMMENT ON FUNCTION /gm) ?? []).length, 7);
});
test("prod-catchup forward-fix: the audit_log vocabulary has the same members as Production (220, md5 of the byte-ordered list read live) and drops only verification.admin_initiated", () => {
  const sql = readFileSync(here(`./${FORWARD_FIX["prod-catchup"].file}`), "utf8");
  const def = sql.split("\n").find((l) => l.includes("ADD CONSTRAINT ck_audit_action_known"));
  const members = [...def.matchAll(/'([a-z_.]*)'::text/g)].map((m) => m[1]).sort();
  assert.equal(members.length, 220);
  assert.equal(createHash("md5").update(members.join(",")).digest("hex"), "7a5e10f77d98c87f392db57872a12b29");
  assert.ok(!members.includes("verification.admin_initiated"));
});
test("prod-catchup: the table parts reuse the marketplace and media-notify forward-fixes unchanged (pinned hashes), guard first, never delete user rows", () => {
  assert.equal(FORWARD_FIX.marketplace.sha256, "72bdfd9b68ef88f85338321d4eb79c711e2d0be3bbf1e708a96b001dee58b734");
  assert.equal(FORWARD_FIX["media-notify"].sha256, "807149eb92e650ae6e3ffccea420fca110ba3a6bf3eed44f9a1be8f799ace6a5");
  for (const fx of ["marketplace", "media-notify"]) {
    const sql = readFileSync(here(FORWARD_FIX[fx].file), "utf8");
    assert.ok(sql.indexOf("$guard$") < sql.search(/\bDROP (TABLE|FUNCTION)\b/), `${fx}: guard before the first drop`);
  }
  // the three bucket limits media-notify restores are the live Production values (5 MiB, read 2026-11-23)
  assert.ok(readFileSync(here(FORWARD_FIX["media-notify"].file), "utf8").includes("SET file_size_limit = 5242880"));
});
test("production scripts: Production only, plan prod-catchup only, hidden password, typed confirmation, backup label mandatory, drift refusal, never include-all", () => {
  for (const f of ["production-apply.sh", "production-preflight.sh"]) {
    const sh = readFileSync(here(`./${f}`), "utf8");
    assert.ok(sh.includes("export GATE_TARGET=production"), f);
    assert.ok(sh.includes('sb link --project-ref "$PROD"') && !sh.includes('sb link --project-ref "$ACC"'), f);
    assert.ok(sh.includes('REFUSED: linked to Acceptance'), f);
    assert.ok(sh.includes("read -r -s -p"), f);
    assert.ok(sh.includes('acceptance-gate.mjs" drift "$PLAN"'), `${f} refuses a plan that does not match main`);
    assert.ok(sh.includes("(prod-catchup|prod-marketplace-v2)") && !sh.includes("prod-batch1"), f);
    assert.ok(!/(sb|supabase)[^\n"]*--include-all|migration repair|db reset/.test(sh.replace(/^#.*$/gm, "")), f);
  }
  const apply = readFileSync(here("./production-apply.sh"), "utf8");
  assert.ok(apply.includes("APPLY $PLAN TO PRODUCTION") && apply.includes("aladdin-production-"));
  assert.ok(apply.includes('[ -e .git ]'), "works from a git worktree too");
  for (const f of ["acceptance-apply.sh", "acceptance-preflight.sh"]) assert.ok(!/prod-(batch1|catchup|marketplace)/.test(readFileSync(here(`./${f}`), "utf8")), `${f} must not accept the Production plan`);
});

// ---------------------------------------------------------------------------------------------------------------------
// plan "marketplace-v2": 20261123090001, 100001, 120001, 130001, 150001, 160001, 160002 on top of Acceptance at 237 / 20261122090002
// ---------------------------------------------------------------------------------------------------------------------
const SLUG_VERSION = "20261124090001";
const STOCK_VERSION = "20261124120001";
const MV2 = () => PLANS["marketplace-v2"];
const MV2_VERSIONS = ["20261123090001", "20261123100001", "20261123120001", "20261123130001", "20261123150001", "20261123160001", "20261123160002"];
const mv2Files = () => readdirSync(here("../../supabase/migrations")).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, 14)).sort();
test("marketplace-v2: 7 pending in order, all newer than the latest applied, 237 -> 244, chained after registration-gate", () => {
  const P = MV2();
  assert.deepEqual(P.pending, MV2_VERSIONS);
  assert.equal(P.applied, 237); assert.equal(P.latest, PLANS["registration-gate"].postContract);
  assert.equal(P.applied + P.pending.length, 244);
  assert.equal(P.postContract, "20261123160002"); assert.equal(P.preContract, "20261122090002");
  assert.deepEqual(checkAcceptance({ plan: "marketplace-v2", list: list("marketplace-v2"), dry: dry(P.pending), localVersions: mv2Files() }), []);
  assert.deepEqual(checkAcceptancePost({ plan: "marketplace-v2", list: { migrations: [...appliedFor(P), ...P.pending.map((v) => ({ local: v, remote: v }))] } }), []);
});
test("marketplace-v2: refuses the 244 state (already applied), a partial push and an extra migration", () => {
  const P = MV2();
  has(checkAcceptance({ plan: "marketplace-v2", list: { migrations: [...appliedFor(P), ...P.pending.map((v) => ({ local: v, remote: v }))] }, dry: dry([]), localVersions: mv2Files() }), /applied migrations, expected 237/);
  has(checkAcceptance({ plan: "marketplace-v2", list: list("marketplace-v2"), dry: dry(P.pending.slice(0, 5)), localVersions: mv2Files() }), /dry run would push/);
  has(checkAcceptance({ plan: "marketplace-v2", list: list("marketplace-v2", [{ local: "20261124090001", remote: null }]), dry: dry([...P.pending, "20261124090001"]), localVersions: mv2Files() }), /pending is/);
});
test("marketplace-v2: the pending set is exactly the migration files after 20261122090002 in this checkout, until a later plan exists; both permission contracts exist", () => {
  assert.deepEqual(mv2Files().filter((v) => v > MV2().latest && v <= MV2().postContract), MV2().pending);
  assert.deepEqual(pendingDrift({ plan: "marketplace-v2", localVersions: mv2Files().filter((v) => v <= MV2().postContract) }), { unplanned: [], missing: [] });
  for (const v of [MV2().preContract, MV2().postContract]) assert.ok(readFileSync(here(`../../supabase/permissions/${v}.json`), "utf8").length > 100);
});
test("marketplace-v2: every function the 7 migrations create is covered by the expected-change list (derived from the SQL, not written by hand)", () => {
  const P = MV2(), dir = here("../../supabase/migrations");
  const hit = (k) => P.changed.some((e) => (e.endsWith("*") ? k.startsWith(e.slice(0, -1)) : k === e || k.startsWith(e + "(")));
  const miss = [];
  for (const f of readdirSync(dir).filter((f) => P.pending.includes(f.slice(0, 14)))) {
    const sql = readFileSync(`${dir}/${f}`, "utf8").replace(/--.*$/gm, "");
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+((?:public|app)\.[a-z_0-9]+)\s*\(/gi)) if (!hit(m[1].toLowerCase())) miss.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(miss, []);
  for (const e of ["public.media_video_scope", "public.notifications.ck_notifications_event_type_known", "public.marketplace_*", "app.marketplace_publication_blockers", "app.notify_from_template"]) assert.ok(P.changed.includes(e), e);
  assert.equal(new Set(P.changed).size, P.changed.length, "no duplicate entries");
});
test("marketplace-v2: a fresh restore-verified snapshot (>= 237 migrations) is mandatory; the 232 one is refused, and the pinned 237 snapshot (20261124T092536Z) passes", () => {
  const P = MV2(), shas = allShas();
  assert.equal(P.freshBackup, true);
  has(checkRecovery({ plan: "marketplace-v2", label: "", forwardFixSha256: shas }), /needs --backup-label of a fresh restore-verified snapshot \(migrations >= 237\)/);
  has(checkRecovery({ plan: "marketplace-v2", label: "aladdin-acceptance-20261122T100424Z", forwardFixSha256: shas }), /has 232 migrations; plan marketplace-v2 needs one taken at 237 or later/);
  has(checkRecovery({ plan: "marketplace-v2", label: "aladdin-acceptance-20261123T000000Z", forwardFixSha256: shas }), /not a pinned restore-verified snapshot/);
  // 2026-11-24: the owner took and restore-tested the fresh snapshot (237) and it is pinned; the gate accepts exactly that label for this plan.
  assert.deepEqual(checkRecovery({ plan: "marketplace-v2", label: "aladdin-acceptance-20261124T092536Z", forwardFixSha256: shas }), []);
  RESTORE_VERIFIED_SNAPSHOTS["aladdin-acceptance-20261123T000000Z"] = { backupRun: "x", restoreRun: "y", tables: 1, rows: 1, migrations: 237 };
  try { assert.deepEqual(checkRecovery({ plan: "marketplace-v2", label: "aladdin-acceptance-20261123T000000Z", forwardFixSha256: shas }), []); }
  finally { delete RESTORE_VERIFIED_SNAPSHOTS["aladdin-acceptance-20261123T000000Z"]; }
  has(checkRecovery({ plan: "marketplace-v2", label: "aladdin-acceptance-20261122T100424Z", forwardFixSha256: { ...shas, "marketplace-v2": "0".repeat(64) } }), /sha256/);
});
test("marketplace-v2 forward-fix: one transaction, every guard before the first change, only the seeded rows are deleted, enum value and prior flag documented", () => {
  const sql = readFileSync(here(FORWARD_FIX["marketplace-v2"].file), "utf8");
  const code = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
  assert.match(code, /^begin;/m); assert.match(code, /commit;\s*$/);
  const low = code.toLowerCase();
  const firstChange = Math.min(...["drop trigger", "drop table", "delete from", "drop column"].map((s) => low.indexOf(s)).filter((i) => i > -1));
  const lastGuard = code.lastIndexOf("select pg_temp.mv2_guard(");
  assert.ok(lastGuard > -1 && lastGuard < firstChange, "all guards precede the first change");
  for (const t of ["marketplace_seller_preset_events", "marketplace_seller_message_presets", "marketplace_seller_delivery_settings", "marketplace_free_shipping_products", "marketplace_seller_settings_events", "marketplace_video_events"]) {
    assert.ok(code.includes(`public.${t}`), `guards ${t}`); assert.match(code, new RegExp(`drop table if exists public\\.${t} cascade`));
  }
  assert.equal((code.match(/^delete from/gim) ?? []).length, 3, "top-level deletes only: the 2 stock templates, the Super Admin grant and the permission (function bodies may delete)");
  assert.doesNotMatch(code.replace(/$function$[sS]*?$function$/g, ""), /btruncateb|deletes+froms+public.marketplace_/i);
  assert.ok(low.indexOf("disable trigger trg_admin_role_permissions_guard") < low.indexOf("delete from public.admin_role_permissions") && low.indexOf("enable trigger trg_admin_role_permissions_guard") > low.indexOf("delete from public.admin_role_permissions"));
  assert.ok(low.indexOf("create or replace function app.marketplace_publication_blockers") < low.indexOf("drop function if exists app.marketplace_is_open"), "old definitions are restored before new functions are dropped");
  assert.doesNotMatch(code, /drop function(?! if exists)/i, "every function drop is IF EXISTS");
  assert.match(sql, /enum value public\.media_video_scope 'marketplace'"?/); assert.match(sql, /media_verification_ready was set to true/);
  assert.ok(!/cascade/i.test(code.replace(/drop table if exists [a-z_.]+ cascade/gi, "")), "CASCADE only on the six new tables");
});
test("marketplace-v2: the apply script knows the plan and runs the smoke before the push and after it; the preflight accepts the plan", () => {
  const apply = readFileSync(here("./acceptance-apply.sh"), "utf8"), pre = readFileSync(here("./acceptance-preflight.sh"), "utf8");
  assert.match(apply, /marketplace-v2\|marketplace-slug\)\$ \]\]/); assert.match(pre, /marketplace-v2\|marketplace-slug\)\$ \]\]/);
  const push = apply.indexOf('STEP="push"');
  assert.ok(apply.indexOf("marketplace-v2-smoke.mjs facts pre") > -1 && apply.indexOf("marketplace-v2-smoke.mjs facts pre") < push);
  assert.ok(apply.indexOf("marketplace-v2-smoke.mjs facts post") > push);
});

// ---------------------------------------------------------------------------------------------------------------------
// plan "prod-marketplace-v2": PRODUCTION twin of marketplace-v2, 237 -> 244 on top of Production at 237 / 20261122090002 (prod-catchup applied 2026-11-23)
// ---------------------------------------------------------------------------------------------------------------------
const PMV2 = () => PLANS["prod-marketplace-v2"];
test("prod-marketplace-v2 (COMBINED, owner decision 2026-11-24): targets production, the seven marketplace-v2 versions plus the slug and stock-notify migrations, 237 / 20261122090002 -> 246 / 20261124120001", () => {
  const P = PMV2(), A = MV2();
  assert.equal(P.target, "production");
  assert.deepEqual(P.pending, [...MV2_VERSIONS, SLUG_VERSION, STOCK_VERSION]);
  assert.equal(P.applied, 237); assert.equal(P.latest, "20261122090002"); assert.equal(P.preContract, "20261122090002");
  assert.equal(P.applied + P.pending.length, 246); assert.equal(P.postContract, STOCK_VERSION);
  assert.deepEqual([...P.changed].sort(), [...new Set([...A.changed, ...PLANS["marketplace-slug"].changed])].sort(), "the measured expected diffs are shared, never re-typed (app.marketplace_stock_notify is in both)");
  assert.deepEqual(P.fixes, ["marketplace-stock-notify", "marketplace-slug", "marketplace-v2"], "recovery order: stock-notify first, then slug, then marketplace-v2"); assert.equal(P.recovery, "forward-fix"); assert.equal(P.freshBackup, true);
  assert.equal(PLANS["prod-catchup"].postContract, P.preContract, "chained: prod-catchup ends where this plan starts");
});
test("prod-marketplace-v2: the Acceptance gate refuses it, the Production gate refuses marketplace-v2, and a push of anything but the seven is refused", () => {
  const P = PMV2();
  has(checkAcceptance({ plan: "prod-marketplace-v2", list: list("prod-marketplace-v2"), dry: dry(P.pending), localVersions: mv2Files() }), /targets production, but this gate was run for acceptance/);
  has(checkAcceptance({ target: "production", plan: "marketplace-v2", list: list("marketplace-v2"), dry: dry(P.pending), localVersions: mv2Files() }), /targets acceptance, but this gate was run for production/);
  has(checkAcceptance({ target: "production", plan: "prod-marketplace-v2", list: list("prod-marketplace-v2"), dry: dry(P.pending.slice(0, 5)), localVersions: mv2Files() }), /dry run would push/);
  // Production still at 210 (prod-catchup not applied): refused, the plan never bridges the gap
  const at210 = { migrations: [...hist(209), { local: "20261112090001", remote: "20261112090001" }, ...PLANS["prod-catchup"].pending.map((v) => ({ local: v, remote: null })), ...P.pending.map((v) => ({ local: v, remote: null }))] };
  has(checkAcceptance({ target: "production", plan: "prod-marketplace-v2", list: at210, dry: dry([...PLANS["prod-catchup"].pending, ...P.pending]), localVersions: mv2Files() }), /applied migrations, expected 237/);
});
test("prod-marketplace-v2: needs a restore-verified PRODUCTION snapshot at >= 237 migrations; the pinned 210 one and every Acceptance label are refused; a future 237+ pin passes", () => {
  const shas = allShas();
  has(checkRecovery({ plan: "prod-marketplace-v2", label: "", forwardFixSha256: shas }), /needs --backup-label of a fresh restore-verified snapshot \(migrations >= 237\)/);
  has(checkRecovery({ plan: "prod-marketplace-v2", label: "aladdin-production-20261123T142725Z", forwardFixSha256: shas }), /has 210 migrations; plan prod-marketplace-v2 needs one taken at 237 or later/);
  has(checkRecovery({ plan: "prod-marketplace-v2", label: "aladdin-acceptance-20261122T100424Z", forwardFixSha256: shas }), /not a pinned restore-verified PRODUCTION snapshot/);
  has(checkRecovery({ plan: "prod-marketplace-v2", label: "aladdin-production-20261123T162323Z", forwardFixSha256: shas }), /not a pinned restore-verified PRODUCTION snapshot/);
  assert.ok(Object.values(PRODUCTION_RESTORE_VERIFIED_SNAPSHOTS).every((s) => s.migrations < 237), "no 237+ Production snapshot is pinned in this PR: its restore test must report PASS first");
  PRODUCTION_RESTORE_VERIFIED_SNAPSHOTS["aladdin-production-20261124T000000Z"] = { backupRun: "x", restoreRun: "y", tables: 1, rows: 1, migrations: 237 };
  try { assert.deepEqual(checkRecovery({ plan: "prod-marketplace-v2", label: "aladdin-production-20261124T000000Z", forwardFixSha256: shas }), []); }
  finally { delete PRODUCTION_RESTORE_VERIFIED_SNAPSHOTS["aladdin-production-20261124T000000Z"]; }
  has(checkRecovery({ plan: "prod-marketplace-v2", label: "aladdin-production-20261123T142725Z", forwardFixSha256: { ...shas, "marketplace-v2": "0".repeat(64) } }), /sha256/);
});
test("prod-marketplace-v2: pending set equals the migration files after 20261122090002 on this checkout (drift check passes today); both permission contracts exist", () => {
  assert.deepEqual(pendingDrift({ plan: "prod-marketplace-v2", localVersions: mv2Files().filter((v) => v <= PMV2().postContract) }), { unplanned: [], missing: [] });
  assert.deepEqual(pendingDrift({ plan: "prod-marketplace-v2", localVersions: [...mv2Files(), "20261125090001"] }).unplanned, ["20261125090001"]);
  for (const c of [PMV2().preContract, PMV2().postContract]) assert.ok(readdirSync(here("../../supabase/permissions")).includes(`${c}.json`), c);
});
test("production scripts: prod-marketplace-v2 runs the marketplace-v2 smoke before the push and after it; the Acceptance scripts do not know the plan", () => {
  const apply = readFileSync(here("./production-apply.sh"), "utf8");
  const push = apply.indexOf('STEP="push"');
  const pre = apply.indexOf("marketplace-v2-smoke.mjs facts pre"), post = apply.indexOf("marketplace-v2-smoke.mjs facts post");
  assert.ok(pre > -1 && pre < push && post > push);
  assert.ok(apply.includes('"$PLAN" = "prod-marketplace-v2"'));
  assert.ok(!/(sb|supabase)[^\n"]*--include-all|migration repair|db reset/.test(apply.replace(/^#.*$/gm, "")));
});

// ---------------------------------------------------------------------------------------------------------------------
// plan "marketplace-slug": 20261124090001 (PR #252, seller public slug) on top of Acceptance at 244 / 20261123160002; also the 8th migration of prod-marketplace-v2
// ---------------------------------------------------------------------------------------------------------------------
const SLUGP = () => PLANS["marketplace-slug"];
const migDir = () => here("../../supabase/migrations");
const slugSql = () => readFileSync(`${migDir()}/${readdirSync(migDir()).find((f) => f.startsWith(SLUG_VERSION))}`, "utf8").replace(/--.*$/gm, "");
test("marketplace-slug: two pending (slug + stock-notify), 244 -> 246, chained after marketplace-v2, function/trigger-only so no fresh backup is required", () => {
  const P = SLUGP();
  assert.deepEqual(P.pending, [SLUG_VERSION, STOCK_VERSION]);
  assert.equal(P.applied, 244); assert.equal(P.latest, MV2().postContract); assert.equal(P.preContract, MV2().postContract);
  assert.equal(P.applied + P.pending.length, 246); assert.equal(P.postContract, STOCK_VERSION);
  assert.equal(P.applied, MV2().applied + MV2().pending.length, "Acceptance is at the marketplace-v2 end state");
  assert.equal(P.target, undefined, "an Acceptance plan"); assert.notEqual(P.freshBackup, true);
  assert.deepEqual(P.fixes, ["marketplace-stock-notify", "marketplace-slug"]); assert.equal(P.recovery, "forward-fix");
  assert.deepEqual(checkAcceptance({ plan: "marketplace-slug", list: list("marketplace-slug"), dry: dry(P.pending), localVersions: mv2Files() }), []);
  assert.deepEqual(checkAcceptancePost({ plan: "marketplace-slug", list: { migrations: [...appliedFor(P), ...P.pending.map((v) => ({ local: v, remote: v }))] } }), []);
  for (const v of [P.preContract, P.postContract]) assert.ok(readdirSync(here("../../supabase/permissions")).includes(`${v}.json`), v);
});
test("marketplace-slug: refuses the 237 state (marketplace-v2 not applied), the 245 state (already applied), the Production gate and any other pending set", () => {
  const P = SLUGP();
  const at237 = { migrations: [...hist(236), { local: "20261122090002", remote: "20261122090002" }, ...[...MV2().pending, SLUG_VERSION, STOCK_VERSION].map((v) => ({ local: v, remote: null }))] };
  has(checkAcceptance({ plan: "marketplace-slug", list: at237, dry: dry([...MV2().pending, SLUG_VERSION, STOCK_VERSION]), localVersions: mv2Files() }), /applied migrations, expected 244/);
  has(checkAcceptance({ plan: "marketplace-slug", list: { migrations: [...appliedFor(P), { local: SLUG_VERSION, remote: SLUG_VERSION }, { local: STOCK_VERSION, remote: STOCK_VERSION }] }, dry: dry([]), localVersions: mv2Files() }), /applied migrations, expected 244/);
  has(checkAcceptance({ target: "production", plan: "marketplace-slug", list: list("marketplace-slug"), dry: dry(P.pending), localVersions: mv2Files() }), /targets acceptance, but this gate was run for production/);
  has(checkAcceptance({ plan: "marketplace-slug", list: list("marketplace-slug", [{ local: "20261125090001", remote: null }]), dry: dry([...P.pending, "20261125090001"]), localVersions: mv2Files() }), /pending is/);
});
test("marketplace-slug: the expected-change list is exactly what the migration creates (2 functions, 1 trigger), derived from the SQL; the Production list is marketplace-v2 + slug", () => {
  const P = SLUGP(), sql = slugSql();
  const fns = [...sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+((?:public|app)\.[a-z_0-9]+)\s*\(/gi)].map((m) => m[1].toLowerCase()).sort();
  const trg = [...sql.matchAll(/create\s+(?:or\s+replace\s+)?trigger\s+([a-z_0-9]+)\s+[\s\S]*?\son\s+(public\.[a-z_0-9]+)/gi)].map((m) => `${m[2]}.${m[1]}`.toLowerCase());
  assert.deepEqual([...P.changed].filter((e) => e !== "app.marketplace_stock_notify").sort(), [...fns, ...trg].sort());
  assert.deepEqual([...P.changed].sort(), [...fns, ...trg, "app.marketplace_stock_notify"].sort(), "the stock-notify migration adds exactly one changed function (replaced, same signature)");
  assert.equal(fns.length, 2); assert.equal(trg.length, 1);
  assert.doesNotMatch(sql, /\b(create|alter|drop)\s+(table|index|type|policy)\b|\bdrop\s+function\b/i, "no table, index, policy or enum; nothing is dropped");
  assert.equal(new Set(PMV2().changed).size, PMV2().changed.length, "no duplicate entries in the combined list");
  for (const e of P.changed) assert.ok(PMV2().changed.includes(e), e);
});
test("marketplace-slug forward-fix: pinned, one transaction, every guard RAISEs before the first drop, only IF EXISTS drops, never touches rows, documents that slugs stay and the combined order", () => {
  const sql = readFileSync(here(FORWARD_FIX["marketplace-slug"].file), "utf8");
  const code = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n"), low = code.toLowerCase();
  assert.match(code, /^begin;/m); assert.match(code, /commit;\s*$/);
  assert.ok(low.lastIndexOf("raise exception") > -1 && low.lastIndexOf("raise exception") < low.indexOf("drop trigger"), "all guards precede the first drop");
  assert.equal((code.match(/raise exception/gi) ?? []).length, 5);
  assert.doesNotMatch(code, /drop (trigger|function)(?! if exists)/i);
  assert.doesNotMatch(code, /\b(delete|update|insert|truncate)\b|cascade/i, "no row is touched and nothing cascades");
  assert.deepEqual([...code.matchAll(/^drop (?:trigger|function) if exists ([a-z_.]+)/gim)].map((m) => m[1]), ["marketplace_seller_slug_assign", "app.marketplace_seller_slug_trigger", "app.marketplace_assign_org_slug"]);
  assert.match(sql, /NOT undone, because it is data: the slugs/); assert.match(sql, /FIRST \(marketplace-slug\), THEN marketplace-v2-remove\.sql/);
  assert.equal(createHash("sha256").update(readFileSync(here(FORWARD_FIX["marketplace-slug"].file))).digest("hex"), FORWARD_FIX["marketplace-slug"].sha256);
});
const stockSql = () => readFileSync(`${migDir()}/${readdirSync(migDir()).find((f) => f.startsWith(STOCK_VERSION))}`, "utf8").replace(/--.*$/gm, "");
test("marketplace-stock-notify migration: EXPAND-only (same-signature CREATE OR REPLACE of one function, default texts only, admin columns untouched), no new permission", () => {
  const sql = stockSql();
  assert.deepEqual([...sql.matchAll(/create\s+or\s+replace\s+function\s+((?:public|app)\.[a-z_0-9]+)\s*\(/gi)].map((m) => m[1]), ["app.marketplace_stock_notify"]);
  assert.doesNotMatch(sql, /\b(drop|create)\s+(table|index|type|policy|trigger)\b|\bdrop\s+function\b|\balter\s+table\b|\bgrant\b|\binsert\b|\bdelete\b/i);
  const sets = [...sql.matchAll(/update public\.notification_templates set([\s\S]*?)\bwhere\b/gi)].map((m) => m[1]);
  assert.equal(sets.length, 2);
  for (const set of sets) assert.doesNotMatch(set, /\b(title_ar|title_en|body_ar|body_en|version|updated_by|updated_at)\b\s*=/, "admin override columns, version and updated_by are never written");
  const pj = (v) => JSON.parse(readFileSync(here(`../../supabase/permissions/${v}.json`), "utf8"));
  const a = pj(SLUG_VERSION), b = pj(STOCK_VERSION);
  assert.deepEqual({ ...b, version: 0, source: "" }, { ...a, version: 0, source: "" }, "no new permission: the contract equals the previous one except version and note");
  assert.equal(b.version, STOCK_VERSION);
});
test("marketplace-stock-notify forward-fix: pinned, one transaction, guard RAISEs before any change, restores the pre-plan function and default texts, never touches admin columns or version", () => {
  const sql = readFileSync(here(FORWARD_FIX["marketplace-stock-notify"].file), "utf8");
  const code = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n"), low = code.toLowerCase();
  assert.match(code, /^begin;/m); assert.match(code, /commit;\s*$/);
  assert.ok(low.indexOf("raise exception") > -1 && low.indexOf("raise exception") < low.indexOf("create or replace function"), "the guard precedes the first change");
  assert.deepEqual([...code.matchAll(/^CREATE OR REPLACE FUNCTION ([a-z_.]+)\(/gm)].map((m) => m[1]), ["app.marketplace_stock_notify"]);
  assert.doesNotMatch(code, /\b(delete|insert|truncate|drop)\b|cascade/i);
  for (const set of [...code.matchAll(/update public\.notification_templates set([\s\S]*?)\bwhere\b/gi)].map((m) => m[1])) assert.doesNotMatch(set, /\b(title_ar|title_en|body_ar|body_en|version|updated_by)\b\s*=/);
  assert.match(code, /jsonb_build_object\('product_name', coalesce\(v_name_ar, v_name_en\), 'quantity', v_new,/, "the previous one-variable call is restored");
  assert.doesNotMatch(code.slice(code.lastIndexOf("$guard$")), /product_name_(ar|en)/, "after the guard, nothing refers to the new variables");
  assert.equal(createHash("sha256").update(readFileSync(here(FORWARD_FIX["marketplace-stock-notify"].file))).digest("hex"), FORWARD_FIX["marketplace-stock-notify"].sha256);
});
test("marketplace-slug: recovery needs no backup label; a pinned label is only a historical reference; a wrong forward-fix sha is refused", () => {
  const shas = allShas();
  assert.deepEqual(checkRecovery({ plan: "marketplace-slug", label: "", forwardFixSha256: shas }), []);
  assert.deepEqual(checkRecovery({ plan: "marketplace-slug", label: "aladdin-acceptance-20261124T092536Z", forwardFixSha256: shas }), []);
  has(checkRecovery({ plan: "marketplace-slug", label: "aladdin-acceptance-20261123T000000Z", forwardFixSha256: shas }), /not a pinned restore-verified snapshot/);
  has(checkRecovery({ plan: "marketplace-slug", label: "", forwardFixSha256: { ...shas, "marketplace-slug": "0".repeat(64) } }), /sha256/);
  has(checkRecovery({ plan: "marketplace-slug", label: "", forwardFixSha256: { ...shas, "marketplace-stock-notify": "0".repeat(64) } }), /marketplace-stock-notify-restore-previous\.sql/);
});
test("prod-marketplace-v2 recovery needs BOTH forward-fixes (slug and marketplace-v2): a wrong sha of either is refused", () => {
  const shas = allShas(), label = "aladdin-production-20261124T000000Z";
  PRODUCTION_RESTORE_VERIFIED_SNAPSHOTS[label] = { backupRun: "x", restoreRun: "y", tables: 1, rows: 1, migrations: 237 };
  try {
    assert.deepEqual(checkRecovery({ plan: "prod-marketplace-v2", label, forwardFixSha256: shas }), []);
    has(checkRecovery({ plan: "prod-marketplace-v2", label, forwardFixSha256: { ...shas, "marketplace-slug": "0".repeat(64) } }), /marketplace-slug-remove\.sql/);
    has(checkRecovery({ plan: "prod-marketplace-v2", label, forwardFixSha256: { ...shas, "marketplace-v2": "0".repeat(64) } }), /marketplace-v2-remove\.sql/);
    has(checkRecovery({ plan: "prod-marketplace-v2", label, forwardFixSha256: { ...shas, "marketplace-stock-notify": "0".repeat(64) } }), /marketplace-stock-notify-restore-previous\.sql/);
  } finally { delete PRODUCTION_RESTORE_VERIFIED_SNAPSHOTS[label]; }
});
test("drift guard: passes today on this checkout for BOTH the Acceptance plan (marketplace-slug) and the Production plan (prod-marketplace-v2), and names an unplanned later migration", () => {
  const all = mv2Files().filter((v) => v <= STOCK_VERSION);
  assert.ok(all.includes(SLUG_VERSION) && all.includes(STOCK_VERSION));
  for (const name of ["marketplace-slug", "prod-marketplace-v2"]) {
    assert.deepEqual(pendingDrift({ plan: name, localVersions: all }), { unplanned: [], missing: [] }, name);
    assert.deepEqual(pendingDrift({ plan: name, localVersions: [...all, "20261125090001"] }).unplanned, ["20261125090001"], name);
  }
  assert.equal(pendingDrift({ plan: "prod-marketplace-v2", localVersions: all.filter((v) => v !== SLUG_VERSION) }).missing[0], SLUG_VERSION, "dropping the slug migration is a gap, not a pass");
  assert.deepEqual(pendingDrift({ plan: "marketplace-v2", localVersions: all }).unplanned, [SLUG_VERSION, STOCK_VERSION], "marketplace-v2 is historical (already applied on Acceptance): the slug migration is outside it, which is why Acceptance uses marketplace-slug");
});
test("scripts: acceptance scripts accept marketplace-slug and run its smoke before and after the push; production scripts run both smokes and pass the 245 history; Production refuses the Acceptance plan", () => {
  const apply = readFileSync(here("./acceptance-apply.sh"), "utf8"), pre = readFileSync(here("./acceptance-preflight.sh"), "utf8"), prod = readFileSync(here("./production-apply.sh"), "utf8");
  assert.match(apply, /marketplace-v2\|marketplace-slug\)\$ \]\]/); assert.match(pre, /marketplace-v2\|marketplace-slug\)\$ \]\]/);
  const push = apply.indexOf('STEP="push"');
  assert.ok(apply.indexOf("marketplace-slug-smoke.mjs facts pre") > -1 && apply.indexOf("marketplace-slug-smoke.mjs facts pre") < push);
  assert.ok(apply.indexOf("marketplace-slug-smoke.mjs facts post") > push);
  const pp = prod.indexOf('STEP="push"');
  assert.ok(prod.indexOf("marketplace-slug-smoke.mjs facts pre") > -1 && prod.indexOf("marketplace-slug-smoke.mjs facts pre") < pp && prod.indexOf("marketplace-slug-smoke.mjs facts post") > pp);
  assert.match(prod, /marketplace-v2-smoke\.mjs facts post "\$OUT\/mv2-post\.json" --applied "\$POST_APPLIED" --latest "\$LATEST"/);
  assert.ok(!/marketplace-slug\)\$/.test(prod), "production-apply.sh does not whitelist the Acceptance plan");
  has(checkAcceptance({ target: "production", plan: "marketplace-slug", list: list("marketplace-slug"), dry: dry([SLUG_VERSION]), localVersions: mv2Files() }), /targets acceptance/);
});
test("marketplace-v2 smoke: the post judgement takes the combined Production history (246 / 20261124120001) and still defaults to 244 / 20261123160002", async () => {
  const { judgeFacts, NEW_TABLES, MUST_EXIST, SEED } = await import("./marketplace-v2-smoke.mjs");
  const f = { applied_migrations: 246, latest_migration: STOCK_VERSION, new_tables: [...NEW_TABLES], templates: 8, stock_templates: 2, presets: 15, preset_actions: SEED.presetActions, marketplace_open: true, marketplace_open_default: "true",
    media_verification_ready: true, enum_has_marketplace: true, permission: 1, permission_super_admin_locked: 1, permission_other_roles: 0, marketplace_videos: 0, sellers: 1, products: 1, published_products: 0,
    functions_present: [...MUST_EXIST], public_status: { open: true }, public_catalog_page: "object", public_facets: "object", publication_blockers_unknown_product: "array" };
  assert.equal(judgeFacts("post", f).ok, false, "default expects 244");
  assert.equal(judgeFacts("post", f, { applied: 246, latest: STOCK_VERSION }).ok, true);
});
