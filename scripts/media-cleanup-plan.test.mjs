import test from "node:test";
import assert from "node:assert/strict";
import { planCleanup, PROJECTS, PRODUCTION_CONFIRMATION } from "./media-cleanup-plan.mjs";

const sched = (env = {}) => planCleanup({ EVENT: "schedule", ...env });
const manual = (env = {}) => planCleanup({ EVENT: "workflow_dispatch", ...env });

test("everything is off by default: a scheduled run does nothing", () => {
  assert.deepEqual(sched(), []);
});
test("scheduled dry-run and execute follow the switch, per project", () => {
  assert.deepEqual(sched({ ACCEPTANCE_MEDIA_CLEANUP: "dry-run" }), [{ label: "acceptance", project: PROJECTS.acceptance, execute: false }]);
  assert.deepEqual(sched({ ACCEPTANCE_MEDIA_CLEANUP: "execute" }), [{ label: "acceptance", project: PROJECTS.acceptance, execute: true }]);
});
test("a scheduled Production 'execute' without backups is a dry run, never a deletion", () => {
  assert.deepEqual(sched({ PRODUCTION_MEDIA_CLEANUP: "execute" }), [{ label: "production", project: PROJECTS.production, execute: false }]);
  assert.deepEqual(sched({ PRODUCTION_MEDIA_CLEANUP: "execute", PRODUCTION_BACKUP_ENABLED: "true" }), [{ label: "production", project: PROJECTS.production, execute: true }]);
});
test("a wrong switch value is refused, not treated as off", () => {
  assert.throws(() => sched({ ACCEPTANCE_MEDIA_CLEANUP: "yes" }), /must be off, dry-run or execute/);
  assert.throws(() => sched({ PRODUCTION_MEDIA_CLEANUP: "EXECUTE" }), /must be off, dry-run or execute/);
});
test("a manual run needs an activated switch and never exceeds it", () => {
  assert.throws(() => manual({ INPUT_LABEL: "acceptance" }), /not activated/);
  assert.deepEqual(manual({ INPUT_LABEL: "acceptance", ACCEPTANCE_MEDIA_CLEANUP: "dry-run" }), [{ label: "acceptance", project: PROJECTS.acceptance, execute: false }]);
  assert.throws(() => manual({ INPUT_LABEL: "acceptance", INPUT_EXECUTE: "true", ACCEPTANCE_MEDIA_CLEANUP: "dry-run" }), /not activated for execution/);
  assert.deepEqual(manual({ INPUT_LABEL: "acceptance", INPUT_EXECUTE: "true", ACCEPTANCE_MEDIA_CLEANUP: "execute" }), [{ label: "acceptance", project: PROJECTS.acceptance, execute: true }]);
});
test("a manual run without 'execute' is always a dry run", () => {
  assert.equal(manual({ INPUT_LABEL: "acceptance", INPUT_EXECUTE: "false", ACCEPTANCE_MEDIA_CLEANUP: "execute" })[0].execute, false);
});
test("a manual Production execute needs backups AND the typed confirmation", () => {
  const base = { INPUT_LABEL: "production", INPUT_EXECUTE: "true", PRODUCTION_MEDIA_CLEANUP: "execute" };
  assert.throws(() => manual(base), /PRODUCTION_BACKUP_ENABLED/);
  assert.throws(() => manual({ ...base, PRODUCTION_BACKUP_ENABLED: "true" }), /type "clean up production media"/);
  assert.throws(() => manual({ ...base, PRODUCTION_BACKUP_ENABLED: "true", INPUT_CONFIRM: "yes" }), /type "clean up production media"/);
  assert.equal(manual({ ...base, PRODUCTION_BACKUP_ENABLED: "true", INPUT_CONFIRM: PRODUCTION_CONFIRMATION })[0].execute, true);
});
test("unknown events and labels are refused", () => {
  assert.throws(() => planCleanup({ EVENT: "push" }), /unknown event/);
  assert.throws(() => manual({ INPUT_LABEL: "staging" }), /choose acceptance or production/);
});
