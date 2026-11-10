import { test } from "node:test";
import assert from "node:assert/strict";
import { PlanError, TARGETS, buildPlan, validate } from "./r2-provision-plan.mjs";

test("both built-in targets are valid under the runtime isolation rules", () => {
  assert.deepEqual(validate("acceptance"), []);
  assert.deepEqual(validate("production"), []);
});

test("production plan creates both buckets, applies reviewed rules, then verifies private access settings", () => {
  const plan = buildPlan("production");
  const writes = plan.steps.filter((s) => s.kind === "write").map((s) => s.command);
  assert.equal(writes.length, 5);
  assert.ok(writes[0].includes("bucket create aladdin-media-private --location weur"));
  assert.ok(plan.steps.some((s) => s.command.includes("dev-url get aladdin-media-private")));
  assert.ok(plan.steps.some((s) => s.command.includes("dev-url get aladdin-site-media")));
});

test("acceptance does not recreate the existing private bucket", () => {
  const writes = buildPlan("acceptance").steps.filter((s) => s.kind === "write").map((s) => s.command);
  assert.ok(!writes.some((c) => c.includes("bucket create aladdin-r2-acceptance-20261011-private")));
  assert.ok(writes.some((c) => c.includes("bucket create aladdin-acceptance-site-media")));
});

test("verify-only emits no write step", () => {
  assert.ok(buildPlan("production", { verifyOnly: true }).steps.every((s) => s.kind === "read"));
});

test("isolation rules refuse bad names", () => {
  const base = TARGETS.production;
  assert.match(validate("production", { ...base, site: "aladdin-test-site" }).join(), /non-Production marker/);
  assert.match(validate("production", { ...base, site: base.private }).join(), /must differ/);
  assert.match(validate("production", { ...base, site: "aladdin-production-db-backups" }).join(), /backup/);
  assert.match(validate("acceptance", { ...TARGETS.acceptance, site: "aladdin-site-media" }).join(), /lacks a non-Production marker/);
  assert.throws(() => buildPlan("nope"), PlanError);
});

test("credentials are least privilege: reconcile credential is read-only and no credential spans both environments", () => {
  const p = buildPlan("production");
  assert.ok(p.credentials.some((c) => /Object Read on/.test(c.scope) && !/Write/.test(c.scope)));
  assert.ok(!JSON.stringify(p.credentials).includes("acceptance"));
});

test("site-only plan writes nothing but the site bucket and its lifecycle, and leaves the private bucket read-only", () => {
  const plan = buildPlan("acceptance", { siteOnly: true });
  const writes = plan.steps.filter((s) => s.kind === "write").map((s) => s.command);
  assert.equal(writes.length, 2);
  assert.ok(writes.every((c) => c.includes("aladdin-acceptance-site-media")));
  assert.ok(plan.steps.some((s) => s.kind === "read" && s.command.includes("aladdin-r2-acceptance-20261011-private")));
  assert.ok(!JSON.stringify(plan.credentials).includes("Secret"));
});
