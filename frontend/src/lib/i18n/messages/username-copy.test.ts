import { describe, expect, it } from "vitest";
import { en } from "./en";
import { ar } from "./ar";
import { productionCopy } from "@/features/installer-settings/production-copy";

describe("username copy matches the editable-username behaviour", () => {
  it("registration no longer says the username cannot be changed (en / ar)", () => {
    expect(en.registration.username.subtitle).not.toMatch(/can't change|cannot change/i);
    expect(ar.registration.username.subtitle).not.toContain("لا يمكنك تغييره");
    expect(en.registration.username.subtitle).toContain("Installers can change it later from Settings");
    expect(ar.registration.username.subtitle).toContain("يمكن للصنايعية تغييره لاحقًا من الإعدادات");
  });

  it("the Settings description does not claim the username is in a profile link (en / ar)", () => {
    expect(productionCopy.en.usernameHint).not.toMatch(/link/i);
    expect(productionCopy.ar.usernameHint).not.toContain("رابط");
  });

  it("the new username failure message exists in both languages", () => {
    expect(en.profileIdentity.username.error.length).toBeGreaterThan(0);
    expect(ar.profileIdentity.username.error.length).toBeGreaterThan(0);
  });

  it("production copy has the same keys in both languages", () => {
    expect(Object.keys(productionCopy.ar).sort()).toEqual(Object.keys(productionCopy.en).sort());
  });
});
