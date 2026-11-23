import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAcceptance, checkAcceptancePost, checkRecovery, FORWARD_FIX, RESTORE_VERIFIED_SNAPSHOTS, PLANS, plan } from "./acceptance-gate.mjs";
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

// plan "prod-batch1": PRODUCTION, 20261114090001 + 20261115090001 on top of Production at 210 / 20261112090001 (read-only 2026-11-23).
test("prod-batch1: targets production, 210 -> 212, 2 pending, newer than the latest applied", () => {
  const P = PLANS["prod-batch1"];
  assert.equal(P.target, "production");
  assert.equal(P.applied, 210); assert.equal(P.latest, "20261112090001");
  assert.deepEqual(P.pending, ["20261114090001", "20261115090001"]);
  assert.ok(P.pending.every((v) => v > P.latest));
  const files = readdirSync(here("../../supabase/migrations")).map((f) => f.slice(0, 14));
  assert.deepEqual(files.filter((v) => v > P.latest && v <= P.postContract), P.pending);
});
test("prod-batch1: both permission contracts exist in this checkout", () => {
  for (const v of [PLANS["prod-batch1"].preContract, PLANS["prod-batch1"].postContract]) assert.ok(readFileSync(here(`../../supabase/permissions/${v}.json`)).length > 0, v);
});
test("prod-batch1: expected-change list = 3 replaced functions, 3 added functions and 1 added trigger", () => {
  assert.deepEqual([...PLANS["prod-batch1"].changed].sort(), [
    "app.assert_assigned_reviewer", "app.craftsman_review_guard", "public.apply_account_upgrade", "public.apply_organization_verification",
    "public.craftsman_profile_verification_submit", "public.review_approve", "public.verifications.craftsman_review_complete"]);
});
test("prod-batch1: the Acceptance gate refuses it and the Production gate refuses every Acceptance plan", () => {
  const P = PLANS["prod-batch1"];
  has(checkAcceptance({ plan: "prod-batch1", list: list("prod-batch1"), dry: dry(P.pending), localVersions: [...P.pending] }), /targets production, but this gate was run for acceptance/);
  has(checkAcceptancePost({ plan: "prod-batch1", list: { migrations: [...appliedFor(P), ...P.pending.map((v) => ({ local: v, remote: v }))] } }), /targets production/);
  for (const name of Object.keys(PLANS).filter((n) => n !== "prod-batch1")) {
    const A = PLANS[name];
    has(checkAcceptance({ target: "production", plan: name, list: list(name), dry: dry(A.pending), localVersions: [...A.pending] }), /targets acceptance, but this gate was run for production/);
  }
});
test("prod-batch1: any Production step needs a restore-verified PRODUCTION snapshot; none is pinned, and an Acceptance snapshot never counts", () => {
  assert.equal(PLANS["prod-batch1"].freshBackup, true);
  const sha = { "prod-batch1": createHash("sha256").update(readFileSync(here(`./${FORWARD_FIX["prod-batch1"].file}`))).digest("hex") };
  has(checkRecovery({ plan: "prod-batch1", label: "", forwardFixSha256: sha }), /needs --backup-label/);
  has(checkRecovery({ plan: "prod-batch1", label: Object.keys(RESTORE_VERIFIED_SNAPSHOTS).at(-1), forwardFixSha256: sha }), /not a pinned restore-verified PRODUCTION snapshot/);
  has(checkRecovery({ plan: "prod-batch1", label: "aladdin-production-20261123T000000Z", forwardFixSha256: sha }), /not a pinned restore-verified PRODUCTION snapshot/);
});
test("prod-batch1: the forward-fix restores the 3 old functions before dropping the guard, is idempotent (IF EXISTS) and one transaction", () => {
  const sql = readFileSync(here(`./${FORWARD_FIX["prod-batch1"].file}`), "utf8").toLowerCase();
  const at = (s) => { const i = sql.indexOf(s); assert.ok(i >= 0, s); return i; };
  const lastRestore = Math.max(at("function public.apply_account_upgrade("), at("function public.apply_organization_verification("), at("function public.review_approve("));
  assert.ok(lastRestore < at("drop function if exists app.assert_assigned_reviewer("), "restore before drop");
  assert.ok(at("drop trigger if exists craftsman_review_complete") < at("drop function if exists app.craftsman_review_guard()"));
  assert.ok(!/drop function (?!if exists)/i.test(sql), "every drop is IF EXISTS");
  assert.ok(sql.includes("begin;") && sql.trimEnd().endsWith("commit;"));
  assert.ok(!/\b(delete|truncate|insert into|update public)\b/i.test(sql.replace(/--.*$/gm, "").replace(/\$function\$[\s\S]*?\$function\$/g, "")), "no data change outside function bodies");
});
test("production scripts: Production only, plan prod-batch1 only, hidden password, typed confirmation, backup label mandatory, never include-all", () => {
  for (const f of ["production-apply.sh", "production-preflight.sh"]) {
    const sh = readFileSync(here(`./${f}`), "utf8");
    assert.ok(sh.includes("export GATE_TARGET=production"), f);
    assert.ok(sh.includes('sb link --project-ref "$PROD"') && !sh.includes('sb link --project-ref "$ACC"'), f);
    assert.ok(sh.includes('REFUSED: linked to Acceptance'), f);
    assert.ok(sh.includes("read -r -s -p"), f);
    assert.ok(!/(sb|supabase)[^\n"]*--include-all|migration repair|db reset/.test(sh.replace(/^#.*$/gm, "")), f);
  }
  const apply = readFileSync(here("./production-apply.sh"), "utf8");
  assert.ok(apply.includes("APPLY $PLAN TO PRODUCTION") && apply.includes("aladdin-production-"));
  assert.ok(apply.includes('[ -e .git ]'), "works from a git worktree too");
  for (const f of ["acceptance-apply.sh", "acceptance-preflight.sh"]) assert.ok(!readFileSync(here(`./${f}`), "utf8").includes("prod-batch1"), `${f} must not accept the Production plan`);
});
