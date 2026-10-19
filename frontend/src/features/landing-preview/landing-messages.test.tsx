import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nMessagesProvider } from "@/lib/i18n/context";
import { I18nProvider } from "@/lib/i18n/provider";
import { directionFor } from "@/lib/i18n/config";
import { pickMessages } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { LandingHero } from "./landing-hero";
import { LandingEcosystem } from "./landing-ecosystem";
import { LandingMotion } from "./landing-motion";
import { LANDING_MESSAGE_NAMESPACES } from "./landing-messages";

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
