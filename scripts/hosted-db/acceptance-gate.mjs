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
 *   registration-gate  20261122090001..002 (Admin registration-state column, the Pending-tab rule, and the central registration gate in the Data API
 *             pre-request hook, ADR-0031) on top of Acceptance at 235 / 20261121090003. 235 -> 237. FUNCTION-ONLY (3 functions replaced, 2 added;
 *             no table, row, policy or grant), so like media+m1 no backup is required: the recovery is the pinned "registration-gate" forward-fix.
 *   marketplace-v2  20261123090001, 100001, 120001, 130001, 150001, 160001, 160002 (PRs #238-#241, #246, #249) on top of Acceptance at 237 / 20261122090002. 237 -> 244. NOT function-only
 *             (6 tables, 24 columns on existing tables, 7 re-created constraints, seeded rows, one enum value): pinned "marketplace-v2" forward-fix and a fresh restore-verified
 *             backup taken at >= 237 migrations is MANDATORY (none is pinned yet: the newest, 232, is refused). See docs/operations/MARKETPLACE_V2_ACCEPTANCE_PLAN_20261123.md.
 *   prod-catchup  PRODUCTION: the single plan 210 -> 237 (27 migrations, 20261114090001 .. 20261122090002, plus PC_LATER). Needs a restore-verified PRODUCTION snapshot (none pinned).
 *   m3a       after `m1` is applied (Acceptance and Production are both at 209 today): only 20261112090001 (P1 M3a) is pending. 209 -> 210.
 *
 *   node acceptance-gate.mjs <plan> <migration-list.json> <dry-run.json> <migrations dir>
 *   node acceptance-gate.mjs post <plan> <migration-list.json>
 *   node acceptance-gate.mjs recovery <plan> <snapshot label|none> <scripts/hosted-db dir>   (forward-fix sha256 / pinned snapshot)
 *   node acceptance-gate.mjs drift <plan> <migrations dir>   (is every newer migration on this checkout in the plan?)
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
const ACC_235 = "20261121090003"; // latest on Acceptance after the media-notify plan (read 2026-11-22: 235 migrations)
const ACC_237 = "20261122090002"; // latest on Acceptance after the registration-gate plan (read 2026-11-23: 237 migrations)
const RG_PENDING = ["20261122090001", "20261122090002"];
// marketplace-v2: the seven Marketplace migrations merged to main on 2026-11-23 (PRs #238-#241, #246, #249), on top of Acceptance at 237.
const MV2_PENDING = ["20261123090001", "20261123100001", "20261123120001", "20261123130001", "20261123150001", "20261123160001", "20261123160002"];
const PROD_210 = "20261112090001"; // latest on PRODUCTION (read-only, 2026-11-23: 210 migrations)
/**
 * prod-catchup: ONE Production plan from 210 / 20261112090001 to current main. PC_PENDING is the single list to edit at execution time: when Marketplace PR 5 / PR 6 (or any
 * other work) add migrations to main, append their versions to PC_LATER, add the objects they change to PC_LATER_CHANGED, extend the forward-fix coverage (see
 * docs/operations/PRODUCTION_CATCHUP_PLAN_20261123.md "Updating the plan at execution time") and re-run the tests: pendingDrift() and the drift test name every version that is
 * on main but not in the plan.
 */
const PC_BASE = [
  "20261114090001",
  "20261115090001", "20261115090002", "20261115090003", "20261115090004", "20261115090005", "20261115090006",
  "20261116090001",
  ...Array.from({ length: 14 }, (_, i) => `202611161000${String(i + 1).padStart(2, "0")}`),
  "20261121090001", "20261121090002", "20261121090003",
  "20261122090001", "20261122090002"
];
export const PC_LATER = []; // versions newer than 20261122090002 that this plan must also push (empty today)
export const PC_LATER_CHANGED = []; // objects those later migrations add or change (function schema.name, or a key prefix ending in *)
export const PC_PENDING = [...PC_BASE, ...PC_LATER];
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
  // registration-gate: function-only. changed = the 3 functions it replaces and the 2 it adds (measured with catalog-fingerprint.sql before/after on a scratch
  // copy: exactly these 5 function differences, nothing else). Recovery: the pinned forward-fix, proven to restore the exact live definitions of the 3 functions.
  "registration-gate": { fixes: ["registration-gate"], recovery: "forward-fix", applied: 235, latest: ACC_235, pending: RG_PENDING, preContract: ACC_235, postContract: "20261122090002",
    changed: ["app.api_pre_request", "app.admin_user_status_tab", "public.admin_users_directory", "app.admin_user_registration_state", "app.registration_gate_allows"] },
  // prod-catchup (PRODUCTION, target "production"): ONE plan for docs/operations/PRODUCTION_CATCHUP_PLAN_20261123.md. Production is at 210 / 20261112090001 (read live 2026-11-23);
  // supabase db push pushes every unapplied local migration, so main's 27 pending cannot be split into batches. 210 -> 237 (+ PC_LATER). Creates tables (Marketplace 30, media limits,
  // notification templates) and changes rows (permissions, three storage bucket limits), so freshBackup: a restore-verified PRODUCTION snapshot is mandatory and none is pinned
  // (PRODUCTION_RESTORE_VERIFIED_SNAPSHOTS pins only aladdin-production-20261123T142725Z, restore PASS), so the plan is refused for any other label. "changed" was MEASURED, not written by hand: replay of the 27 on a scratch
  // database with scripts/hosted-db/catalog-fingerprint.sql before/after and catalog-diff.mjs (170 functions, the touched constraints/trigger, and prefixes for the new tables).
  // Run only through production-preflight.sh / production-apply.sh; the Acceptance scripts refuse it.
  "prod-catchup": { target: "production", fixes: ["media-notify", "marketplace", "prod-catchup"], recovery: "forward-fix", freshBackup: true, applied: 210, latest: PROD_210, pending: PC_PENDING, preContract: PROD_210, postContract: PC_PENDING.at(-1),
    changed: [
      "app.admin_user_registration_state",
      "app.admin_user_status_tab",
      "app.api_pre_request",
      "app.assert_assigned_reviewer",
      "app.bv_decide",
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
      "app.media_limit_bytes",
      "app.media_limit_events_append_only",
      "app.media_metadata",
      "app.media_storage_key_for",
      "app.media_videos_enforce_cap",
      "app.notification_template_events_append_only",
      "app.notify_from_template",
      "app.registration_gate_allows",
      "app.render_template",
      "app.showroom_activation_guard",
      "app.showroom_review_guard",
      "app.template_variables",
      "public.admin_initiate_verification",
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
      "public.admin_media_limit_events",
      "public.admin_media_limit_set",
      "public.admin_notification_template_events",
      "public.admin_notification_template_reset",
      "public.admin_notification_template_set",
      "public.admin_notification_templates",
      "public.admin_organization_detail",
      "public.admin_organizations_list",
      "public.admin_user_detail",
      "public.admin_users_directory",
      "public.apply_account_upgrade",
      "public.apply_organization_verification",
      "public.business_verification_request_info",
      "public.craftsman_profile_verification_submit",
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
      "public.marketplace_rejected_images_purge",
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
      "public.media_limits_get",
      "public.media_storage_attest",
      "public.media_storage_reserve",
      "public.media_storage_resolve",
      "public.organization_media_resolve",
      "public.review_approve",
      "public.review_reject",
      "public.audit_log.ck_audit_action_known",
      "public.media_storage_locations.media_storage_locations_namespace_check",
      "public.media_videos.media_videos_cap_on_insert",
      "public.notifications.ck_notifications_content_shape",
      "public.notifications.ck_notifications_event_type_known",
      "public.verifications.ck_verifications_reason_required",
      "public.verifications.showroom_review_complete",
      "public.marketplace_*",
      "public.ux_marketplace_*",
      "public.ix_marketplace_*",
      "public.uq_marketplace_*",
      "public.media_limit*",
      "public.notification_template*",
      "public.notifications.content*",
      ...PC_LATER_CHANGED
    ] },
  // marketplace-v2: 237 -> 244. Adds 6 tables (seller message presets and their events, seller delivery settings, per-product free shipping, seller settings
  // events, product video events), columns, constraints and indexes, seeds rows (owner-message presets, 2 stock notification templates, 1 permission) and one enum
  // value, and adds or re-creates functions (EXPAND only: changed signatures are added next to the old ones). Needs a fresh restore-verified backup (>= 237 migrations)
  // and the pinned "marketplace-v2" forward-fix. "changed" was MEASURED by scripts/hosted-db/marketplace-v2-scratch-proof.mjs (scratch container, ROLLBACK), not written by hand.
  "marketplace-v2": { fixes: ["marketplace-v2"], recovery: "forward-fix", freshBackup: true, applied: 237, latest: ACC_237, pending: MV2_PENDING, preContract: ACC_237, postContract: "20261123160002",
    changed: [
      "app.marketplace_delivery_terms",
      "app.marketplace_free_shipping",
      "app.marketplace_is_open",
      "app.marketplace_media_verification_ready",
      "app.marketplace_product_guard",
      "app.marketplace_product_is_listed",
      "app.marketplace_product_review_state",
      "app.marketplace_product_ships_free",
      "app.marketplace_public_image_key",
      "app.marketplace_public_stock_left",
      "app.marketplace_publication_blockers",
      "app.marketplace_review_approve_image",
      "app.marketplace_review_products",
      "app.marketplace_seller_commerce_missing",
      "app.marketplace_seller_delivery_ready",
      "app.marketplace_seller_is_public",
      "app.marketplace_seller_payment_ready",
      "app.marketplace_seller_transition",
      "app.marketplace_seller_unpublish_all",
      "app.marketplace_settings_event",
      "app.marketplace_settings_events_append_only",
      "app.marketplace_stock_notify",
      "app.marketplace_video_event",
      "app.marketplace_video_free_slot",
      "app.marketplace_video_manager",
      "app.media_videos_enforce_cap",
      "app.notify_from_template",
      "app.video_writable",
      "public.admin_marketplace_media_approve",
      "public.admin_marketplace_pending_videos",
      "public.admin_marketplace_platform_status",
      "public.admin_marketplace_product_review_approve",
      "public.admin_marketplace_product_review_queue",
      "public.admin_marketplace_product_review_reject",
      "public.admin_marketplace_product_review_summary",
      "public.admin_marketplace_product_videos",
      "public.admin_marketplace_seller_approve",
      "public.admin_marketplace_seller_history_v2",
      "public.admin_marketplace_seller_overview_v2",
      "public.admin_marketplace_seller_preset_save",
      "public.admin_marketplace_seller_presets",
      "public.admin_marketplace_seller_reinstate",
      "public.admin_marketplace_seller_reject",
      "public.admin_marketplace_seller_revoke",
      "public.admin_marketplace_seller_suspend",
      "public.admin_marketplace_set_media_verification_ready",
      "public.admin_marketplace_set_open",
      "public.admin_marketplace_video_review",
      "public.marketplace_checkout_place",
      "public.marketplace_product_video_list",
      "public.marketplace_public_browse",
      "public.marketplace_public_cart",
      "public.marketplace_public_catalog",
      "public.marketplace_public_catalog_page",
      "public.marketplace_public_delivery",
      "public.marketplace_public_facets",
      "public.marketplace_public_product",
      "public.marketplace_public_seller",
      "public.marketplace_public_status",
      "public.marketplace_seller_commerce_readiness",
      "public.marketplace_seller_delivery_areas_save",
      "public.marketplace_seller_delivery_get",
      "public.marketplace_seller_delivery_prices_save",
      "public.marketplace_seller_delivery_terms_save",
      "public.marketplace_seller_free_shipping_products_get",
      "public.marketplace_seller_image_replace_request_upload",
      "public.marketplace_seller_image_request_upload",
      "public.marketplace_seller_images_update",
      "public.marketplace_seller_payment_settings_get",
      "public.marketplace_seller_payment_settings_save",
      "public.marketplace_seller_pickup_set",
      "public.marketplace_seller_product_free_shipping_set",
      "public.marketplace_seller_product_publication_state",
      "public.marketplace_seller_product_save",
      "public.marketplace_seller_products_page",
      "public.marketplace_seller_request_approval",
      "public.media_edge_video",
      "public.video_delete",
      "public.video_update",
      "public.video_upload_begin",
      "public.media_video_scope",
      "public.notifications.ck_notifications_event_type_known",
      "public.media_videos.*",
      "public.ix_media_videos_*",
      "public.uq_media_videos_marketplace_slot",
      "public.marketplace_*",
      "public.ix_marketplace_*",
      "public.ux_marketplace_*",
      "public.ix_mp_*"
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
  // 2026-11-22: taken and restore-tested (CLI 3.2.0) with Acceptance at 232 migrations (latest 20261116100014); the fresh snapshot the media-notify plan needs.
  "aladdin-acceptance-20261122T100424Z": { backupRun: "45010533680", restoreRun: "45019578075", tables: 202, rows: 3815, migrations: 232 },
};
/** Restore-verified PRODUCTION snapshots (label must start with aladdin-production-). A label is pinned here only after its restore test reported RESULT: PASS; every other Production label is refused. */
export const PRODUCTION_RESTORE_VERIFIED_SNAPSHOTS = {
  // 2026-11-23: taken (backup run 45194259216, complete coverage verified, ledger succeeded) and restore-tested (restore run 45199513364: RESULT PASS,
  // sha256 e030c87a32873a200dd55066d039a5fd0dfb1c746e7d033b5eaf9aebbaa354ff, schema fingerprint exact, 172 tables / 32355 rows exact, R2 media inventory exact: 1313 files,
  // 21 of 21 sampled restored with the recorded sha256) with Production at 210 migrations (latest 20261112090001). The snapshot the prod-catchup plan needs.
  "aladdin-production-20261123T142725Z": { backupRun: "45194259216", restoreRun: "45199513364", tables: 172, rows: 32355, migrations: 210 },
};
export const FORWARD_FIX = {
  // marketplace: refuses (RAISE) while any seller/product/order/import/stock row or marketplace media object exists; never deletes user data.
  // It is the only recovery of the "marketplace" plan. It restores exactly the media functions and constraint the 14 Marketplace migrations
  // re-created, so it is valid at 218 too (the verification migrations never touch them).
  // verification: restores what 20261115090002..006 changed. Those migrations are already applied on Acceptance, so NO plan uses it today;
  // kept (reviewed, pinned) for a future rollback of them. It does NOT undo the rows they wrote (only a restore-tested backup can).
  marketplace: { file: "forward-fix/marketplace-remove.sql", sha256: "72bdfd9b68ef88f85338321d4eb79c711e2d0be3bbf1e708a96b001dee58b734" },
  // media-notify: refuses (RAISE) once an admin changed a limit or template or any notification was written from a template; never deletes user data.
  "media-notify": { file: "forward-fix/media-notify-remove.sql", sha256: "807149eb92e650ae6e3ffccea420fca110ba3a6bf3eed44f9a1be8f799ace6a5" },
  // registration-gate: function-only. Restores app.api_pre_request, app.admin_user_status_tab and public.admin_users_directory to their exact pre-plan definitions (md5 of
  // pg_get_functiondef and of the comment equal the live Acceptance values read before the plan) and drops the two added functions. Touches no data.
  "registration-gate": { file: "forward-fix/registration-gate-restore-previous.sql", sha256: "39f99de6d09a5a7d1b5e0250091ec2eadaa37c56c55b3e382857fe43daf22d18" },
  // prod-catchup: the NON-table part of the Production catch-up. Restores 14 functions to their exact PRODUCTION definitions (md5 of pg_get_functiondef and of the comment read live on
  // Production 2026-11-23), the showroom review trigger + guard (with the owner-only ACL), the two constraints and drops the 5 functions the catch-up adds. The table parts are the
  // "media-notify" and "marketplace" forward-fixes (re-proved against Production's pre-state: Production pre-state + 27 migrations + the three files = identical catalog fingerprint).
  // Undo order: media-notify, marketplace, prod-catchup.
  "prod-catchup": { file: "forward-fix/prod-catchup-restore-previous.sql", sha256: "1137c10d511193a4cee599a1105b5a3bbb6ae714fdd5f04b753a932c3740ce7a" },
  "marketplace-v2": { file: "forward-fix/marketplace-v2-remove.sql", sha256: "6f2e8ec3b8bbdba721245479165240ef51608da61396cc4ae9250fddb4fabc6a" },
  verification: { file: "forward-fix/verification-restore-previous.sql", sha256: "a50cd460c243b3580927c1f8b8e84ec1cc1109048c9b08b055a06b470570fcac" },
  m1: { file: "forward-fix/m1-restore-previous.sql", sha256: "5fe0da1eb5f08143b52ff90c41294d7e0e45ed7b7017926b6296898acfd28045" },
  m3a: { file: "forward-fix/m3a-restore-previous.sql", sha256: "d4161977e7664e3345d000ee87503fd3a5983935c81257dd082c0a5ef0b43ec3" },
  media: { file: "forward-fix/media-restore-previous.sql", sha256: "4f0f4ce33ed49ca85555756ff7186a33da6d3b6cca17f391da9bc4daf735f270" },
};
/** Versions on this checkout newer than the plan's latest applied that the plan does not list, and plan versions missing from the checkout (empty = the plan matches main). */
export function pendingDrift({ plan: name, localVersions }) {
  const P = plan(name);
  return {
    unplanned: localVersions.filter((v) => v > P.latest && !P.pending.includes(v)).sort(),
    missing: P.pending.filter((v) => !localVersions.includes(v))
  };
}
/** forwardFixSha256: { <fix name>: <sha256 of the file in this checkout, or undefined> } for every fix the plan needs. */
export function checkRecovery({ plan: name, label, forwardFixSha256 = {} }) {
  const P = plan(name), p = [];
  const prod = P.target === "production";
  const REG = prod ? PRODUCTION_RESTORE_VERIFIED_SNAPSHOTS : RESTORE_VERIFIED_SNAPSHOTS;
  // A plan that creates tables is not recoverable by function-only forward-fixes alone (they never restore rows), so it needs a pinned,
  // restore-verified snapshot taken AFTER Acceptance reached the plan's starting history (its migrations count must be >= plan.applied).
  if (P.freshBackup) {
    const snap = label ? REG[label] : undefined;
    if (!label) p.push(`plan ${name} needs --backup-label of a fresh restore-verified snapshot (migrations >= ${P.applied})`);
    else if (snap && snap.migrations < P.applied) p.push(`snapshot ${label} has ${snap.migrations} migrations; plan ${name} needs one taken at ${P.applied} or later`);
  }
  if (label && !Object.prototype.hasOwnProperty.call(REG, label)) {
    p.push(`backup label ${label} is not a pinned restore-verified ${prod ? "PRODUCTION " : ""}snapshot (${Object.keys(REG).join(", ") || "none pinned"}); add it to RESTORE_VERIFIED_SNAPSHOTS only after its restore test reports RESULT: PASS`);
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

export function checkAcceptance({ plan: name, list, dry, localVersions, target = "acceptance" }) {
  const P = plan(name), p = [];
  if ((P.target ?? "acceptance") !== target) p.push(`plan ${name} targets ${P.target ?? "acceptance"}, but this gate was run for ${target}`);
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
export function checkAcceptancePost({ plan: name, list, target = "acceptance" }) {
  const P = plan(name), p = [];
  if ((P.target ?? "acceptance") !== target) p.push(`plan ${name} targets ${P.target ?? "acceptance"}, but this gate was run for ${target}`);
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
  const target = process.env.GATE_TARGET === "production" ? "production" : "acceptance"; // set only by production-preflight.sh / production-apply.sh
  try {
    const [a, b, c, d] = process.argv.slice(2);
    if (a === "describe") {
      const P = plan(b);
      console.log(`PRE_CONTRACT=${P.preContract}\nPOST_CONTRACT=${P.postContract}\nRECOVERY=${P.recovery}
N_PENDING=${P.pending.length}\nPOST_APPLIED=${P.applied + P.pending.length}\nLATEST=${P.pending.at(-1)}
PENDING_VERSIONS="${P.pending.join(" ")}"\nEXPECT_CHANGED='${P.changed.join(";")}'`);
      process.exit(0);
    }
    if (a === "drift") {
      // node acceptance-gate.mjs drift <plan> <migrations dir>
      const d = pendingDrift({ plan: b, localVersions: readdirSync(c).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, 14)) });
      if (d.unplanned.length || d.missing.length) { console.error(`plan ${b} does not match this checkout\n  - not in the plan: ${d.unplanned.join(", ") || "none"}\n  - in the plan but missing here: ${d.missing.join(", ") || "none"}\nUpdate PC_LATER / PC_LATER_CHANGED and the forward-fix coverage first (docs/operations/PRODUCTION_CATCHUP_PLAN_20261123.md).`); process.exit(1); }
      console.log(`plan ${b}: matches this checkout (${plan(b).pending.length} pending, none unplanned)`);
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
      if ((plan(b).target ?? "acceptance") !== target) problems.unshift(`plan ${b} targets ${plan(b).target ?? "acceptance"}, but this gate was run for ${target}`);
      if (problems.length) { console.error("Acceptance recovery gate: REFUSED\n" + problems.map((x) => `  - ${x}`).join("\n")); process.exit(1); }
      const snap = c !== "none" ? RESTORE_VERIFIED_SNAPSHOTS[c] : null;
      console.log(`Acceptance recovery gate: ok (plan ${b}: forward-fix ${plan(b).fixes.map((x) => `${x} sha256 ${FORWARD_FIX[x].sha256.slice(0, 12)}`).join(", ")} verified${snap ? `; snapshot ${c} is a HISTORICAL reference (restore PASS run ${snap.restoreRun}, ${snap.migrations} migrations), not a current recovery point` : ""})`);
      process.exit(0);
    }
    if (a === "post") {
      const problems = checkAcceptancePost({ plan: b, list: j(c), target });
      if (problems.length) { console.error("Acceptance post-push gate: FAILED\n" + problems.map((x) => `  - ${x}`).join("\n")); process.exit(1); }
      const P = plan(b);
      console.log(`Acceptance post-push gate: ok (${P.applied + P.pending.length} applied, latest ${P.pending.at(-1)}, none pending)`);
      process.exit(0);
    }
    const problems = checkAcceptance({ plan: a, list: j(b), dry: j(c), localVersions: readdirSync(d).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, 14)), target });
    if (problems.length) { console.error("Acceptance gate: REFUSED\n" + problems.map((x) => `  - ${x}`).join("\n")); process.exit(1); }
    const P = plan(a);
    console.log(`Acceptance gate: ok (plan ${a}: ${P.applied} applied, latest ${P.latest}, exactly [${P.pending.join(", ")}] pending, plain push, no drift)`);
  } catch (e) { console.error(`UNUSABLE INPUT: ${e.message}`); process.exit(2); }
}
