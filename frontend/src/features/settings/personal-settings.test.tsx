import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { createTranslator } from "@/lib/i18n/translate";
import type { PersonalHomeData } from "@/server/queries/personal-home";

vi.mock("@/server/actions/availability", () => ({
  setAvailabilityAction: async () => ({ ok: true }),
}));
vi.mock("@/server/actions/auth", () => ({
  signOut: async () => {},
}));
vi.mock("@/server/actions/profile-identity", () => ({
  setDisplayNameAction: async () => ({ ok: true }),
  setPhoneAction: async () => ({ ok: true }),
  requestAvatarUploadAction: async () => ({ ok: false, code: "profileIdentity.avatar.errorUpload" }),
  confirmAvatarUploadAction: async () => ({ ok: false, code: "profileIdentity.avatar.errorUpload" }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { PersonalSettings } from "./personal-settings";

const t = createTranslator("en");

function home(overrides: Partial<PersonalHomeData> = {}): PersonalHomeData {
  return {
    variant: "professional",
    displayName: "Sayed Abdel-Rahman",
    accountType: "installer_technician",
    isSalesperson: false,
    phone: null,
    completeness: { percent: 100, completed: 5, total: 5, missing: [] },
    verification: { state: "verified", reason: null, decidedAt: null },
    availability: { available: true, updatedAt: "2026-09-01T00:00:00Z" },
    consumer: {} as PersonalHomeData["consumer"],
    professional: {} as PersonalHomeData["professional"],
    sales: null,
    ...overrides,
  } as PersonalHomeData;
}

/**
 * `/home/settings` (Increment 14, D7) — a composition surface. The property
 * that matters most: nothing here is invented. Every section either reuses a
 * real component (`AvailabilityControl`) verbatim or names a real, already-
 * shipped route/action, and the Profile/Availability sections disappear
 * entirely for a consumer rather than rendering an empty or fake state.
 */
describe("PersonalSettings", () => {
  it("shows the professional profile section with a real edit entry point", () => {
    renderWithI18n(<PersonalSettings home={home()} signInEmail="s••••@example.test" theme="light" t={t} />, "en");
    expect(screen.getByText("Sayed Abdel-Rahman")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Edit profile" }).getAttribute("href")).toBe("/home/profile/edit");
  });

  it("shows the real availability control for a professional", () => {
    renderWithI18n(<PersonalSettings home={home()} signInEmail={null} theme="light" t={t} />, "en");
    expect(screen.getByText("Availability")).toBeTruthy();
  });

  it("hides the professional-only sections for a consumer, without a fake placeholder", () => {
    renderWithI18n(
      <PersonalSettings home={home({ variant: "consumer" })} signInEmail={null} theme="light" t={t} />,
      "en",
    );
    expect(screen.queryByText("Professional profile")).toBeNull();
    expect(screen.queryByRole("link", { name: "Edit profile" })).toBeNull();
    // Preferences and account are universal — still present for a consumer.
    expect(screen.getByText("Language & appearance")).toBeTruthy();
    expect(screen.getByText("Sign-in & account")).toBeTruthy();
  });

  it("shows the masked sign-in contact, never the raw address", () => {
    renderWithI18n(
      <PersonalSettings home={home()} signInEmail="s••••@example.test" theme="light" t={t} />,
      "en",
    );
    expect(screen.getByText("s••••@example.test")).toBeTruthy();
  });

  it("states the passwordless model instead of offering a password control", () => {
    renderWithI18n(<PersonalSettings home={home()} signInEmail={null} theme="light" t={t} />, "en");
    expect(screen.getByText(/Aladdin has no passwords/)).toBeTruthy();
    expect(screen.queryByText(/password/i, { selector: "input" })).toBeNull();
  });

  it("provides a real sign-out control", () => {
    renderWithI18n(<PersonalSettings home={home()} signInEmail={null} theme="light" t={t} />, "en");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("renders in Arabic with no key leak", () => {
    const { container } = renderWithI18n(
      <PersonalSettings home={home()} signInEmail={null} theme="light" t={createTranslator("ar")} />,
      "ar",
    );
    expect(screen.getAllByText("الإعدادات").length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/personalSettings\.|personalNav\./);
  });

  const identity = {
    displayName: "Member",
    displayNameConfirmed: false,
    username: "sayed",
    phoneCountryIso2: null,
    phoneNational: null,
    phoneE164: null,
    avatarUrl: null,
  };

  it("offers the shared identity fields to EVERY audience, consumers included", () => {
    renderWithI18n(
      <PersonalSettings home={home({ variant: "consumer" })} signInEmail={null} theme="light" t={t} identity={identity} />,
      "en",
    );
    expect(screen.getByTestId("identity-card")).toBeTruthy();
    expect(screen.getByLabelText("Display name")).toBeTruthy();
    expect(screen.getByTestId("avatar-field")).toBeTruthy();
    // Egypt is the default country, not the only one.
    expect((screen.getByLabelText("Country") as HTMLSelectElement).value).toBe("EG");
    expect(screen.getByLabelText("Country").querySelectorAll("option").length).toBeGreaterThan(200);
  });

  it("flags an automatic display name as NOT confirmed until it is saved here", () => {
    renderWithI18n(<PersonalSettings home={home()} signInEmail={null} theme="light" t={t} identity={identity} />, "en");
    expect(screen.getByTestId("display-name-status").textContent).toMatch(/Not confirmed yet/);
  });

  it("never shows a Preferred Language field — the AR/EN switch stays the only language control", () => {
    renderWithI18n(<PersonalSettings home={home()} signInEmail={null} theme="light" t={t} identity={identity} />, "en");
    expect(screen.queryByText(/preferred language/i)).toBeNull();
  });

  it("shows the Complete Profile card while incomplete, and not at 100%", () => {
    const first = renderWithI18n(
      <PersonalSettings home={home()} signInEmail={null} theme="light" t={t} completion={{ percent: 60, missing: ["phone"] }} />,
      "en",
    );
    expect(screen.getByTestId("complete-profile-card")).toBeTruthy();
    first.unmount();
    renderWithI18n(
      <PersonalSettings home={home()} signInEmail={null} theme="light" t={t} completion={{ percent: 100, missing: [] }} />,
      "en",
    );
    expect(screen.queryByTestId("complete-profile-card")).toBeNull();
  });
});
