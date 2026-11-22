#!/usr/bin/env node
/**
 * Pure decision logic for the Acceptance preflight (acceptance-preflight.sh) and the apply script. No network.
 *
 * Re-pinned 2026-11-11 to the ACTUAL Acceptance history read read-only on 2026-11-11T10:14Z: 207 applied, latest
 * 20261107090006 (the four 2026-11-07 migrations are already applied). The old 203-migration / 090003..090006 pin is gone.
 * A plan names exactly which migrations may be pending and what the history must look like before and after:
 *
 *   media     main today: only 20261110090001 (Track C media ids-only keys) is pending. 207 -> 208.
 *   m1        after `media` is applied: only 20261110090002 (P1 M1) is pending. 208 -> 209.
 *   media+m1  one plain push of both, in order. 207 -> 209.
 *   marketplace  Marketplace (#190): 14 migrations (20261116100001..014) on top of Acceptance at 218 / 20261116090001. 218 -> 232.
 *             The verification work (#192/#200: 20261115090002..006) and 20261116090001 are ALREADY applied on Acceptance (applied there
 *             outside this plan) and are not part of it. NOT function-only: it creates 30 tables and 9 sequences, so recovery is the
 *             pinned "marketplace" forward-fix and, unlike the function-only plans, a fresh restore-tested backup is required
 *             (a pinned snapshot with >= 218 migrations: see RESTORE_VERIFIED_SNAPSHOTS).
 *   media-notify  20261121090001..003 (media caps, admin upload limits, notification templates) on top of Acceptance at 232 / 20261116100014.
 *             232 -> 235. Creates tables: pinned "media-notify" forward-fix plus a fresh restore-verified backup (>= 232 migrations).
 *   m3a       after `m1` is applied (Acceptance and Production are both at 209 today): only 20261112090001 (P1 M3a) is pending. 209 -> 210.
 *
 *   node acceptance-gate.mjs <plan> <migration-list.json> <dry-run.json> <migrations dir>
 *   node acceptance-gate.mjs post <plan> <migration-list.json>
 *   node acceptance-gate.mjs recovery <plan> <snapshot label|none> <scripts/hosted-db dir>   (forward-fix sha256 / pinned snapshot)
 *   node acceptance-gate.mjs describe <plan>      (prints shell-safe KEY=VALUE lines for acceptance-apply.sh)
 */
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ACCEPTANCE_REF = "nxossqhdfltcqdwvbewi";
const MEDIA = "20261110090001", M1 = "20261110090002", M3A = "20261112090001", BASE = "20261107090006";
const ACC_218 = "20261116090001"; // latest on Acceptance: #192/#200 (20261115090001..006) and the organization approval state (20261116090001)
const ACC_232 = "20261116100014"; // latest on Acceptance after the Marketplace plan (read 2026-11-22: 232 migrations)
const MN_PENDING = ["20261121090001", "20261121090002", "20261121090003"];
const MKT_PENDING = Array.from({ length: 14 }, (_, i) => `202611161000${String(i + 1).padStart(2, "0")}`);
/** changed = function names (schema.name, every overload) the plan is allowed to touch; nothing else may change in the catalog. */
export const PLANS = {
  media: { fixes: ["media"], recovery: "forward-fix", applied: 207, latest: BASE, pending: [MEDIA], preContract: BASE, postContract: MEDIA,
    changed: ["app.media_storage_key_assign", "public.media_migration_target_key", "public.media_migration_switch", "public.media_migration_rollback"] },
  m1: { fixes: ["m1"], recovery: "forward-fix", applied: 208, latest: MEDIA, pending: [M1], preContract: MEDIA, postContract: M1,
    changed: ["public.my_registration_state", "app.profile_completion", "public.admin_users_directory"] },
  m3a: { fixes: ["m3a"], recovery: "forward-fix", applied: 209, latest: M1, pending: [M3A], preContract: M1, postContract: M3A,
    changed: ["public.pending_registration_consume", "public.pending_registration_save", "public.admin_users_directory", "public.admin_user_detail"] },
  // Marketplace: 14 pending, all newer than the latest applied (plain push). changed = the function names the Marketplace migrations
  // add, change or replace (every overload; measured on a clean replay of the 19 migrations, minus the 12 functions, 2 triggers and 2
  // constraints that only the verification migrations touch - those are already on Acceptance), the media constraint they re-create,
  // and prefixes for everything the Marketplace adds (tables, columns, indexes, constraints, triggers, policies, grants all start with these).
  marketplace: { fixes: ["marketplace"], recovery: "forward-fix", freshBackup: true, applied: 218, latest: ACC_218, pending: MKT_PENDING, preContract: ACC_218, postContract: "20261116100014",
    changed: [
      "app.marketplace_append_only",
      "app.marketplace_assert_admin_permission",
      "app.marketplace_assert_seller_admin",
      "app.marketplace_assert_seller_reader",
      "app.marketplace_assert_seller_writer",
      "app.marketplace_attribute_definition_guard",
      "app.marketplace_attribute_json",
      "app.marketplace_attribute_option_guard",
      "app.marketplace_attribute_value_guard",
      "app.marketplace_attribute_value_ok",
      "app.marketplace_can_manage_catalog",
      "app.marketplace_can_manage_orders",
      "app.marketplace_import_apply_attribute",
      "app.marketplace_import_apply_row",
      "app.marketplace_import_assert_lease",
      "app.marketplace_import_cancel_impl",
      "app.marketplace_import_create_impl",
      "app.marketplace_import_flag",
      "app.marketplace_import_job_guard",
      "app.marketplace_import_parse_asset_name",
      "app.marketplace_import_record_finding",
      "app.marketplace_import_row_findings",
      "app.marketplace_import_set_status",
      "app.marketplace_import_slug",
      "app.marketplace_import_write_guard",
      "app.marketplace_inventory_level_guard",
      "app.marketplace_media_can_delete",
      "app.marketplace_media_can_read",
      "app.marketplace_media_can_upload",
      "app.marketplace_media_cleanup_rows",
      "app.marketplace_media_metadata",
      "app.marketplace_media_retire",
      "app.marketplace_media_storage_key",
      "app.marketplace_media_verification_ready",
      "app.marketplace_movement_seller_guard",
      "app.marketplace_order_document",
      "app.marketplace_order_event",
      "app.marketplace_order_stock",
      "app.marketplace_product_cover_image",
      "app.marketplace_product_guard",
      "app.marketplace_product_has_publishable_image",
      "app.marketplace_proof_require_verified_media",
      "app.marketplace_pta_guard",
      "app.marketplace_public_image_key",
      "app.marketplace_publication_blockers",
      "app.marketplace_refresh_variant_signature",
      "app.marketplace_require_verified_media",
      "app.marketplace_seller_account_guard",
      "app.marketplace_seller_apply_attributes",
      "app.marketplace_seller_is_eligible",
      "app.marketplace_seller_is_enabled",
      "app.marketplace_seller_stage_import_assets",
      "app.marketplace_seller_transition",
      "app.marketplace_stock_location_guard",
      "app.marketplace_stock_movement_append_only",
      "app.marketplace_type_attribute_in_use_guard",
      "app.marketplace_variant_available",
      "app.marketplace_variant_guard",
      "app.marketplace_variant_signature",
      "app.media_metadata",
      "app.media_storage_key_for",
      "public.admin_marketplace_media_approve",
      "public.admin_marketplace_media_queue",
      "public.admin_marketplace_media_record_validation",
      "public.admin_marketplace_media_reject",
      "public.admin_marketplace_media_settings",
      "public.admin_marketplace_seller_approve",
      "public.admin_marketplace_seller_history",
      "public.admin_marketplace_seller_overview",
      "public.admin_marketplace_seller_reinstate",
      "public.admin_marketplace_seller_revoke",
      "public.admin_marketplace_seller_suspend",
      "public.admin_marketplace_sellers",
      "public.admin_marketplace_set_media_verification_ready",
      "public.marketplace_buyer_order_cancel",
      "public.marketplace_buyer_order_get",
      "public.marketplace_buyer_orders",
      "public.marketplace_buyer_proof_confirm",
      "public.marketplace_buyer_proof_request_upload",
      "public.marketplace_checkout_place",
      "public.marketplace_import_apply_next",
      "public.marketplace_import_cancel",
      "public.marketplace_import_claim",
      "public.marketplace_import_complete_dry_run",
      "public.marketplace_import_create",
      "public.marketplace_import_job_cancel",
      "public.marketplace_import_job_create",
      "public.marketplace_import_job_report",
      "public.marketplace_import_purge_staging",
      "public.marketplace_import_release",
      "public.marketplace_import_retry_failed",
      "public.marketplace_import_seal",
      "public.marketplace_import_stage_assets",
      "public.marketplace_import_stage_rows",
      "public.marketplace_import_validate_next",
      "public.marketplace_product_publish",
      "public.marketplace_product_unpublish",
      "public.marketplace_public_cart",
      "public.marketplace_public_catalog",
      "public.marketplace_public_catalog_page",
      "public.marketplace_public_facets",
      "public.marketplace_public_image_ref",
      "public.marketplace_public_product",
      "public.marketplace_seller_default_location",
      "public.marketplace_seller_delivery_areas_save",
      "public.marketplace_seller_delivery_get",
      "public.marketplace_seller_delivery_prices_save",
      "public.marketplace_seller_image_confirm_upload",
      "public.marketplace_seller_image_remove",
      "public.marketplace_seller_image_remove_finalize",
      "public.marketplace_seller_image_request_upload",
      "public.marketplace_seller_images_pending_removal",
      "public.marketplace_seller_images_update",
      "public.marketplace_seller_import_step",
      "public.marketplace_seller_order_get",
      "public.marketplace_seller_order_transition",
      "public.marketplace_seller_orders_page",
      "public.marketplace_seller_payment_settings_get",
      "public.marketplace_seller_payment_settings_save",
      "public.marketplace_seller_pickup_set",
      "public.marketplace_seller_product_get",
      "public.marketplace_seller_product_readiness",
      "public.marketplace_seller_product_save",
      "public.marketplace_seller_products_page",
      "public.marketplace_seller_proof_review",
      "public.marketplace_seller_publish_ready",
      "public.marketplace_seller_stock_adjust",
      "public.marketplace_stock_apply",
      "public.media_cleanup_candidates",
      "public.media_cleanup_retire",
      "public.media_edge_authorize",
      "public.media_edge_public",
      "public.media_storage_attest",
      "public.media_storage_reserve",
      "public.media_storage_resolve",
      "public.organization_media_resolve",
      "public.media_storage_locations.media_storage_locations_namespace_check",
      "public.marketplace_*",
      "public.ux_marketplace_*",
      "public.ix_marketplace_*",
      "public.uq_marketplace_*"
    ] },
  // media-notify: media policy caps + admin-configurable upload limits + bilingual notification templates. 232 -> 235. Creates 4 tables and
  // 1 sequence pair, so like the marketplace plan it needs a fresh restore-verified backup (>= 232 migrations) and a pinned forward-fix.
  "media-notify": { fixes: ["media-notify"], recovery: "forward-fix", freshBackup: true, applied: 232, latest: ACC_232, pending: MN_PENDING, preContract: ACC_232, postContract: "20261121090003",
    changed: [
      "public.media_storage_attest",
      "public.media_limits*", "public.media_limit_events*", "public.notification_templates*", "public.notification_template_events*",
      "public.notifications.content*", "public.notifications.ck_notifications_*",
      "public.media_videos.media_videos_cap_on_insert",
      "app.media_videos_enforce_cap", "app.media_limit_bytes", "app.media_limit_events_append_only",
      "app.notification_template_events_append_only", "app.notify_from_template", "app.render_template", "app.template_variables",
      "public.admin_media_limit_events", "public.admin_media_limit_set", "public.admin_notification_template_events",
      "public.admin_notification_template_reset", "public.admin_notification_template_set", "public.admin_notification_templates",
      "public.marketplace_rejected_images_purge"
    ] },
  "media+m1": { fixes: ["media", "m1"], recovery: "forward-fix", applied: 207, latest: BASE, pending: [MEDIA, M1], preContract: BASE, postContract: M1,
    changed: ["app.media_storage_key_assign", "public.media_migration_target_key", "public.media_migration_switch", "public.media_migration_rollback",
      "public.my_registration_state", "app.profile_completion", "public.admin_users_directory"] },
};

/**
 * Recovery evidence (re-pinned 2026-11-11). Every plan's migrations replace or add functions only: CREATE OR REPLACE FUNCTION /
 * CREATE FUNCTION plus REVOKE/GRANT, no table DDL and no top-level DML. Applying them rewrites no stored row (proven for the media
 * migration by row digests, see P1-EVIDENCE 8.4), BUT they do change runtime behaviour (the three M1 functions; the media trigger
 * function and the media switch/rollback semantics), so "function-only" is not "no behaviour change".
 * Recovery for such a change is a locally tested FORWARD-FIX (a new migration), pinned here by sha256 and checked before the
 * password prompt. A data restore of a backup is not the recovery path and no backup is required for these plans.
 *   m1     forward-fix/m1-restore-previous.sql
 *   m3a    forward-fix/m3a-restore-previous.sql  (re-creates the previous consume/directory/detail and drops the new save overload; proven
 *          locally: M3a + this script gives a catalog fingerprint identical to the pre-M3a one)
 *   media  forward-fix/media-restore-previous.sql  (has a data-safety guard: it refuses once a switched object holds an ids-only key,
 *          i.e. it is only valid before the Track C copy rehearsal calls media_migration_switch under the new semantics)
 * An optional --backup-label is accepted only if it is in RESTORE_VERIFIED_SNAPSHOTS (restore PASS recorded in aladdin-backups).
 * That snapshot is a historical reference, NOT a current full recovery point: taken at 203 migrations, it does not cover later data
 * changes. A fresh restore-tested backup stays mandatory before M2, M3, Auth metadata cleanup, audit-log redaction, the Track C
 * media copy (media_migration_switch calls) and any Production step.
 */
export const RESTORE_VERIFIED_SNAPSHOTS = {
  "aladdin-acceptance-20261108T094450Z": { backupRun: "42468447400", restoreRun: "42469078723", tables: 167, rows: 2584, migrations: 203 },
  // 2026-11-16: taken and restore-tested with Acceptance at 218 migrations (latest 20261116090001); the fresh snapshot the marketplace plan needs.
  "aladdin-acceptance-20261116T152127Z": { backupRun: "43895224195", restoreRun: "43896940335", tables: 172, rows: 3149, migrations: 218 },
};
export const FORWARD_FIX = {
  // marketplace: refuses (RAISE) while any seller/product/order/import/stock row or marketplace media object exists; never deletes user data.
  // It is the only recovery of the "marketplace" plan. It restores exactly the media functions and constraint the 14 Marketplace migrations
  // re-created, so it is valid at 218 too (the verification migrations never touch them).
  // verification: restores what 20261115090002..006 changed. Those migrations are already applied on Acceptance, so NO plan uses it today;
  // kept (reviewed, pinned) for a future rollback of them. It does NOT undo the rows they wrote (only a restore-tested backup can).
  marketplace: { file: "forward-fix/marketplace-remove.sql", sha256: "72bdfd9b68ef88f85338321d4eb79c711e2d0be3bbf1e708a96b001dee58b734" },
  // media-notify: refuses (RAISE) once an admin changed a limit or template or any notification was written from a template; never deletes user data.
  "media-notify": { file: "forward-fix/media-notify-remove.sql", sha256: "97f24d26990816369bc4cd19d51f4f259528936cfc0fae6b7576e7219acee9d2" },
  verification: { file: "forward-fix/verification-restore-previous.sql", sha256: "a50cd460c243b3580927c1f8b8e84ec1cc1109048c9b08b055a06b470570fcac" },
  m1: { file: "forward-fix/m1-restore-previous.sql", sha256: "5fe0da1eb5f08143b52ff90c41294d7e0e45ed7b7017926b6296898acfd28045" },
  m3a: { file: "forward-fix/m3a-restore-previous.sql", sha256: "d4161977e7664e3345d000ee87503fd3a5983935c81257dd082c0a5ef0b43ec3" },
  media: { file: "forward-fix/media-restore-previous.sql", sha256: "4f0f4ce33ed49ca85555756ff7186a33da6d3b6cca17f391da9bc4daf735f270" },
};
/** forwardFixSha256: { <fix name>: <sha256 of the file in this checkout, or undefined> } for every fix the plan needs. */
export function checkRecovery({ plan: name, label, forwardFixSha256 = {} }) {
  const P = plan(name), p = [];
  // A plan that creates tables is not recoverable by function-only forward-fixes alone (they never restore rows), so it needs a pinned,
  // restore-verified snapshot taken AFTER Acceptance reached the plan's starting history (its migrations count must be >= plan.applied).
  if (P.freshBackup) {
    const snap = label ? RESTORE_VERIFIED_SNAPSHOTS[label] : undefined;
    if (!label) p.push(`plan ${name} needs --backup-label of a fresh restore-verified snapshot (migrations >= ${P.applied})`);
    else if (snap && snap.migrations < P.applied) p.push(`snapshot ${label} has ${snap.migrations} migrations; plan ${name} needs one taken at ${P.applied} or later`);
  }
  if (label && !Object.prototype.hasOwnProperty.call(RESTORE_VERIFIED_SNAPSHOTS, label)) {
    p.push(`backup label ${label} is not a pinned restore-verified snapshot (${Object.keys(RESTORE_VERIFIED_SNAPSHOTS).join(", ")}); add it to RESTORE_VERIFIED_SNAPSHOTS only after its restore test reports RESULT: PASS`);
  }
  for (const fx of P.fixes) {
    const F = FORWARD_FIX[fx];
    if (!F) { p.push(`plan ${name} needs forward-fix "${fx}" but none is pinned`); continue; }
    const got = forwardFixSha256[fx];
    if (got !== F.sha256) p.push(`forward-fix ${F.file} is missing or its sha256 (${got ?? "none"}) differs from the pinned ${F.sha256}`);
  }
  return p;
}
export const plan = (name) => {
  const p = PLANS[name];
  if (!p) throw new Error(`unknown plan "${name}"; expected one of ${Object.keys(PLANS).join(", ")}`);
  return p;
};
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export function checkAcceptance({ plan: name, list, dry, localVersions }) {
  const P = plan(name), p = [];
  const rows = list?.migrations ?? [];
  const remote = rows.filter((r) => r.remote).map((r) => String(r.remote)).sort();
  const pending = rows.filter((r) => r.local && !r.remote).map((r) => String(r.local)).sort();
  if (remote.length !== P.applied) p.push(`Acceptance has ${remote.length} applied migrations, expected ${P.applied}`);
  if (remote.at(-1) !== P.latest) p.push(`latest applied is ${remote.at(-1)}, expected ${P.latest}`);
  const remoteOnly = rows.filter((r) => r.remote && !r.local);
  if (remoteOnly.length) p.push(`remote-only (history drift): ${remoteOnly.map((r) => r.remote).join(", ")}`);
  if (!same(pending, P.pending)) p.push(`pending is [${pending.join(", ")}], expected exactly [${P.pending.join(", ")}]`);
  // plain push must be possible: every pending version is newer than the latest applied (no --include-all needed)
  const older = pending.filter((v) => remote.length && v < remote.at(-1));
  if (older.length) p.push(`out-of-order pending (would need --include-all, not allowed here): ${older.join(", ")}`);
  const would = (dry?.migrations ?? []).map((f) => String(f).slice(0, 14));
  if (dry?.dryRun !== true) p.push("the dry run output does not say dryRun:true");
  if (!same(would, P.pending)) p.push(`dry run would push [${would.join(", ")}], expected exactly [${P.pending.join(", ")}]`);
  for (const v of P.pending) if (!localVersions.includes(v)) p.push(`migration file ${v} is not in this checkout`);
  return p;
}

/** After the real push: applied + pending.length applied, latest = last pending, none pending, no remote-only. */
export function checkAcceptancePost({ plan: name, list }) {
  const P = plan(name), p = [];
  const rows = list?.migrations ?? [];
  const remote = rows.filter((r) => r.remote).map((r) => String(r.remote)).sort();
  const want = P.applied + P.pending.length;
  if (remote.length !== want) p.push(`${remote.length} applied after the push, expected ${want}`);
  if (remote.at(-1) !== P.pending.at(-1)) p.push(`latest applied is ${remote.at(-1)}, expected ${P.pending.at(-1)}`);
  for (const v of P.pending) if (!remote.includes(v)) p.push(`${v} is not applied`);
  const pending = rows.filter((r) => r.local && !r.remote);
  if (pending.length) p.push(`still pending: ${pending.map((r) => r.local).join(", ")}`);
  const remoteOnly = rows.filter((r) => r.remote && !r.local);
  if (remoteOnly.length) p.push(`remote-only: ${remoteOnly.map((r) => r.remote).join(", ")}`);
  return p;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const j = (f) => JSON.parse(readFileSync(f, "utf8").replace(/^[^{]*/, ""));
  try {
    const [a, b, c, d] = process.argv.slice(2);
    if (a === "describe") {
      const P = plan(b);
      console.log(`PRE_CONTRACT=${P.preContract}\nPOST_CONTRACT=${P.postContract}\nRECOVERY=${P.recovery}
N_PENDING=${P.pending.length}\nPOST_APPLIED=${P.applied + P.pending.length}\nLATEST=${P.pending.at(-1)}
PENDING_VERSIONS="${P.pending.join(" ")}"\nEXPECT_CHANGED='${P.changed.join(";")}'`);
      process.exit(0);
    }
    if (a === "recovery") {
      // node acceptance-gate.mjs recovery <plan> <label|none> <scripts/hosted-db dir containing forward-fix/>
      const shas = {};
      for (const fx of plan(b).fixes) {
        const F = FORWARD_FIX[fx];
        try { shas[fx] = createHash("sha256").update(readFileSync(resolve(d, F.file))).digest("hex"); } catch { shas[fx] = undefined; }
      }
      const problems = checkRecovery({ plan: b, label: c === "none" ? "" : c, forwardFixSha256: shas });
      if (problems.length) { console.error("Acceptance recovery gate: REFUSED\n" + problems.map((x) => `  - ${x}`).join("\n")); process.exit(1); }
      const snap = c !== "none" ? RESTORE_VERIFIED_SNAPSHOTS[c] : null;
      console.log(`Acceptance recovery gate: ok (plan ${b}: forward-fix ${plan(b).fixes.map((x) => `${x} sha256 ${FORWARD_FIX[x].sha256.slice(0, 12)}`).join(", ")} verified${snap ? `; snapshot ${c} is a HISTORICAL reference (restore PASS run ${snap.restoreRun}, ${snap.migrations} migrations), not a current recovery point` : ""})`);
      process.exit(0);
    }
    if (a === "post") {
      const problems = checkAcceptancePost({ plan: b, list: j(c) });
      if (problems.length) { console.error("Acceptance post-push gate: FAILED\n" + problems.map((x) => `  - ${x}`).join("\n")); process.exit(1); }
      const P = plan(b);
      console.log(`Acceptance post-push gate: ok (${P.applied + P.pending.length} applied, latest ${P.pending.at(-1)}, none pending)`);
      process.exit(0);
    }
    const problems = checkAcceptance({ plan: a, list: j(b), dry: j(c), localVersions: readdirSync(d).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, 14)) });
    if (problems.length) { console.error("Acceptance gate: REFUSED\n" + problems.map((x) => `  - ${x}`).join("\n")); process.exit(1); }
    const P = plan(a);
    console.log(`Acceptance gate: ok (plan ${a}: ${P.applied} applied, latest ${P.latest}, exactly [${P.pending.join(", ")}] pending, plain push, no drift)`);
  } catch (e) { console.error(`UNUSABLE INPUT: ${e.message}`); process.exit(2); }
}
