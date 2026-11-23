import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import type { RegistrationState } from "@/server/queries/registration";

vi.mock("@/server/actions/registration", () => ({ recordConsentAction: vi.fn(async () => ({ ok: false })) }));

import { OnboardingPanel } from "./onboarding-panel";

describe("OnboardingPanel — retired username_pending state", () => {
  // Before migration M1 the database can still return "username_pending". The username step no longer exists, so the
  // panel shows a neutral notice (never a username form, never a crash) in both languages.
  it.each([
    ["en", "We're finishing your account setup"],
    ["ar", "نحن نُنهي إعداد حسابك"],
  ] as const)("shows a neutral notice in %s", (locale, title) => {
    const { container } = renderWithI18n(<OnboardingPanel state={"username_pending" as RegistrationState} />, locale);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(title);
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent?.toLowerCase()).not.toContain("username");
  });

  it("still shows the blocked copy for a manually blocked account", () => {
    renderWithI18n(<OnboardingPanel state="manually_blocked" />, "en");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Account on hold");
  });
});
