import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nMessagesProvider } from "@/lib/i18n/context";
import { I18nProvider } from "@/lib/i18n/provider";
import { directionFor } from "@/lib/i18n/config";
import { pickMessages } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { LandingHero } from "./landing-hero";
import { LandingEcosystem } from "./landing-ecosystem";
import { LandingMotion } from "./landing-motion";
import { LANDING_MESSAGE_NAMESPACES, landingMessages } from "./landing-messages";
import { LandingHeader } from "./landing-header";
import { REGISTRATION_CHOICE_ORDER } from "@/lib/onboarding/account-types";

// The language switch calls a Server Action module; the landing render never invokes it.
vi.mock("@/server/actions/preferences", () => ({ setLocale: vi.fn(), setTheme: vi.fn() }));

function landing() {
  return (
    <LandingMotion>
      <LandingHero />
      <LandingEcosystem />
    </LandingMotion>
  );
}

describe("Landing page message slice", () => {
  it.each<Locale>(["en", "ar"])("renders %s exactly as it does with the full catalog", (locale) => {
    const dir = directionFor(locale);
    const full = render(<I18nProvider locale={locale} dir={dir}>{landing()}</I18nProvider>);
    const fullHtml = full.container.innerHTML;
    full.unmount();
    const slice = render(
      <I18nMessagesProvider locale={locale} dir={dir} messages={pickMessages(locale, LANDING_MESSAGE_NAMESPACES)}>
        {landing()}
      </I18nMessagesProvider>,
    );
    expect(slice.container.innerHTML).toBe(fullHtml);
    // And the slice is a slice: one language, a few namespaces, not the catalog.
    expect(Object.keys(pickMessages(locale, LANDING_MESSAGE_NAMESPACES))).toEqual([...LANDING_MESSAGE_NAMESPACES]);
  });
});

describe("Landing page message slice: header account-type menu", () => {
  it.each<Locale>(["en", "ar"])("names every account type in %s (no raw catalog keys)", (locale) => {
    render(
      <I18nMessagesProvider locale={locale} dir={directionFor(locale)} messages={landingMessages(locale)}>
        <LandingHeader />
      </I18nMessagesProvider>,
    );
    fireEvent.click(screen.getByRole("button", { expanded: false, name: /create account|إنشاء حساب/i }));
    const menu = document.getElementById("register-menu")!;
    expect(menu.textContent).not.toMatch(/onboarding\./);
    expect(within(menu).getAllByRole("listitem")).toHaveLength(REGISTRATION_CHOICE_ORDER.length);
  });

  it("carries only onboarding.accountType, not the whole onboarding namespace", () => {
    expect(Object.keys(landingMessages("ar").onboarding)).toEqual(["accountType"]);
  });
});
