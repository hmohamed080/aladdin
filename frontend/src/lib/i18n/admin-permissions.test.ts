import { describe, expect, it } from "vitest";
import { ADMIN_PERMISSIONS } from "@/lib/permissions/admin";
import { ar } from "./messages/ar";
import { en } from "./messages/en";

/**
 * Admin permission display labels: every permission key the console knows has a localized RESOURCE label and ACTION
 * description in BOTH catalogs, and the Arabic ones are really Arabic (not the English database text leaking into the
 * Arabic UI, which is what the newer Notes / Follow-ups / Cases / Duplicates permissions used to do).
 * Permission KEYS are never translated or changed.
 */
const split = (key: string) => {
  const [resource, ...rest] = key.split(".");
  return { resource: resource!, action: rest.join(".") };
};
const hasArabic = (s: string | undefined) => /[؀-ۿ]/.test(s ?? "");

describe("Admin permission labels", () => {
  const arStaff = ar.admin.preview.staff as unknown as { resources: Record<string, string>; permissionDesc: Record<string, Record<string, string>> };
  const enStaff = en.admin.preview.staff as unknown as { resources: Record<string, string>; permissionDesc: Record<string, Record<string, string>> };

  it("every permission has a resource label and an action description in both locales", () => {
    for (const key of ADMIN_PERMISSIONS) {
      const { resource, action } = split(key);
      expect(enStaff.resources[resource], `en resource for ${key}`).toBeTruthy();
      expect(arStaff.resources[resource], `ar resource for ${key}`).toBeTruthy();
      expect(enStaff.permissionDesc[resource]?.[action], `en description for ${key}`).toBeTruthy();
      expect(arStaff.permissionDesc[resource]?.[action], `ar description for ${key}`).toBeTruthy();
    }
  });

  it("the Arabic labels and descriptions are Arabic, not English text", () => {
    for (const key of ADMIN_PERMISSIONS) {
      const { resource, action } = split(key);
      expect(hasArabic(arStaff.resources[resource]), `ar resource label for ${key}`).toBe(true);
      expect(hasArabic(arStaff.permissionDesc[resource]?.[action]), `ar description for ${key}`).toBe(true);
    }
  });

  it("the English display text is unchanged for the previously unlocalized permissions", () => {
    expect(enStaff.permissionDesc.notes?.read).toBe("Read internal Admin Notes on users and organizations.");
    expect(enStaff.permissionDesc.follow_ups?.manage).toBe("Log, assign and complete Admin follow-ups.");
    expect(enStaff.permissionDesc.cases?.create).toBe("Open an internal Admin report / case.");
    expect(enStaff.permissionDesc.duplicates?.resolve).toBe(
      "Link a duplicate organization to its existing record, or dismiss the suggestion (no merge).",
    );
    expect(enStaff.resources.notes).toBe("notes");
  });
});
