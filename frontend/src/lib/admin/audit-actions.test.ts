import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, auditActionKey } from "./audit-actions";
import { en } from "@/lib/i18n/messages/en";
import { ar } from "@/lib/i18n/messages/ar";

/**
 * The Admin audit feed falls back to the raw enum key when a label is missing —
 * which is what Pilot UAT saw on /admin/audit. These pin the catalog so a new
 * audit action cannot ship without both translations.
 */
describe("audit action labels", () => {
  const enActions = en.admin.actions as Record<string, string>;
  const arActions = ar.admin.actions as Record<string, string>;

  it("has an English label for every emittable audit action", () => {
    const missing = AUDIT_ACTIONS.filter((a) => !enActions[auditActionKey(a)]);
    expect(missing, `missing English labels: ${missing.join(", ")}`).toEqual([]);
  });

  it("has an Arabic label for every emittable audit action", () => {
    const missing = AUDIT_ACTIONS.filter((a) => !arActions[auditActionKey(a)]);
    expect(missing, `missing Arabic labels: ${missing.join(", ")}`).toEqual([]);
  });

  it("carries no label for an action the platform cannot emit", () => {
    const known = new Set(AUDIT_ACTIONS.map(auditActionKey));
    const orphans = Object.keys(enActions).filter((k) => !known.has(k));
    expect(orphans, `labels with no audit action: ${orphans.join(", ")}`).toEqual([]);
  });

  it("maps a dotted action to its flat catalog key", () => {
    expect(auditActionKey("verification.review_started")).toBe("verification_review_started");
  });
});
