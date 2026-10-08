import { renderToString } from "react-dom/server";
import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithI18n } from "@/test/render";
import { I18nProvider } from "@/lib/i18n/context";
import { directionFor } from "@/lib/i18n/config";
import type { Locale } from "@/lib/i18n/locales";
import { PhoneField } from "./phone-field";

/**
 * HYDRATION SAFETY OF THE SHARED PHONE PICKER.
 *
 * The country picker (a searchable listbox on the shared floating surface; it replaced a native `<select>`) used to
 * label its options with `Intl.DisplayNames`, whose answer
 * depends on the ICU / CLDR build: Node (the server) and Chromium (the client) spell Hong
 * Kong, Macao, Palestine and the Falkland Islands differently, so the server's HTML and the
 * client's first render disagreed — React error #418 on every page drawing the field,
 * in English and in Arabic. The field must now render the SAME text whatever the platform
 * says, which is what these tests pin down by changing what the platform says.
 */

const realDisplayNames = Intl.DisplayNames;
afterEach(() => {
  (Intl as unknown as { DisplayNames: unknown }).DisplayNames = realDisplayNames;
});

/** The server's HTML. React separates adjacent text nodes with `<!-- -->`; they carry no text. */
function markup(locale: Locale) {
  return renderToString(
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <PhoneField onChange={() => undefined} />
    </I18nProvider>,
  ).replace(/<!-- -->/g, "");
}

/** A platform whose ICU names every region differently from the real one. */
function useOtherIcu() {
  class OtherIcu {
    of(code: string) {
      return `ICU-${code}`;
    }
  }
  (Intl as unknown as { DisplayNames: unknown }).DisplayNames = OtherIcu;
}

describe("PhoneField renders the same markup on every platform", () => {
  for (const locale of ["ar", "en"] as const) {
    it(`${locale}: the server's HTML does not depend on the platform's Intl.DisplayNames`, () => {
      const here = markup(locale);
      useOtherIcu();
      const elsewhere = markup(locale);
      expect(elsewhere).toBe(here);
    });
  }

  it("does not read Intl.DisplayNames at all", () => {
    let reads = 0;
    (Intl as unknown as { DisplayNames: unknown }).DisplayNames = new Proxy(realDisplayNames, {
      construct() {
        reads += 1;
        throw new Error("Intl.DisplayNames must not be used to label countries");
      },
    });
    markup("ar");
    markup("en");
    expect(reads).toBe(0);
  });

  it("labels the countries that differ between ICU builds with their pinned names (the list is drawn on the client, on open)", () => {
    for (const [locale, hongKong, palestine] of [["en", "Hong Kong", "Palestine"], ["ar", "هونغ كونغ", "فلسطين"]] as const) {
      const { unmount } = renderWithI18n(<PhoneField onChange={() => undefined} />, locale);
      fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Country" : "الدولة" }));
      const list = screen.getByRole("listbox");
      const text = (name: string) => within(list).getAllByRole("option").find((o) => o.textContent?.includes(name))?.textContent ?? "";
      expect(text(hongKong)).toContain("+852");
      expect(text(palestine)).toContain("+970");
      unmount();
    }
  });

  it("shows Egypt first and selected in both locales — the closed picker reads flag + +20", () => {
    for (const locale of ["en", "ar"] as const) {
      const html = markup(locale);
      expect(html).toContain("+20");
      expect(html).toContain("🇪🇬");
      expect(html).not.toContain("<option");
    }
    const { unmount } = renderWithI18n(<PhoneField onChange={() => undefined} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Country" }));
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("option")[0]!.textContent).toContain("Egypt");
    unmount();
  });

  it("is searchable and keyboard-operable: type to filter, Arrow Down reaches the list, Enter chooses, focus returns to the button", () => {
    const changes: unknown[] = [];
    renderWithI18n(<PhoneField onChange={(v) => changes.push(v)} />, "en");
    const button = screen.getByRole("button", { name: "Country" });
    fireEvent.click(button);
    const search = screen.getByRole("textbox", { name: "Search country" });
    fireEvent.change(search, { target: { value: "saudi" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getAllByRole("option")[0]);
    fireEvent.click(screen.getAllByRole("option")[0]!);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(button.textContent).toContain("+966");
    expect(document.activeElement).toBe(button);
  });

  it("Escape closes the list and returns focus to the button", () => {
    renderWithI18n(<PhoneField onChange={() => undefined} />, "en");
    const button = screen.getByRole("button", { name: "Country" });
    fireEvent.click(button);
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("compact: a narrow country picker, the number input takes the room", () => {
    const html = renderToString(
      <I18nProvider locale="ar" dir="rtl">
        <PhoneField compact onChange={() => undefined} />
      </I18nProvider>,
    ).replace(/<!-- -->/g, "");
    expect(html).toContain("w-[7rem]");
    expect(html).not.toContain("w-[9.5rem]");
    expect(html).toContain("+20");
    expect(html).toContain("min-w-0 flex-1");
  });

  it("the default (non-compact) picker is unchanged, so every other form keeps its layout", () => {
    expect(markup("en")).toContain("w-[9.5rem]");
  });
});
