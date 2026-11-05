import { describe, it, expect } from "vitest";
import { useState } from "react";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { en } from "@/lib/i18n/messages/en";
import { ar } from "@/lib/i18n/messages/ar";
import type { SocialPlatform } from "@/lib/onboarding/social-links";
import { ARBITRARY_COLOR, HEX, TAILWIND_PALETTE, UNKNOWN_SEMANTIC_UTILITY } from "../../../eslint/ui-foundation-guard.mjs";
import { SocialLinksCard } from "./social-links-card";

/**
 * The showroom links card (docs/frontend/showroom-social-links-onboarding.md, "The screen"):
 * four aria-expanded toggles, one ltr input per opened platform, a counter of VALID links,
 * a "will be saved as" preview, and errors that can never be hidden.
 */
const L = en.onboarding.business.links;
const blank: Record<SocialPlatform, string> = { facebook: "", instagram: "", tiktok: "", website: "" };

function Harness({ initial = blank, showErrors = false, focusPlatform = null }: { initial?: Record<SocialPlatform, string>; showErrors?: boolean; focusPlatform?: SocialPlatform | null }) {
  const [values, setValues] = useState(initial);
  return (
    <SocialLinksCard
      values={values}
      onChange={(p, v) => setValues((s) => ({ ...s, [p]: v }))}
      showErrors={showErrors}
      focusPlatform={focusPlatform}
    />
  );
}

const toggle = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });
const inputs = () => screen.queryAllByRole("textbox");

describe("SocialLinksCard", () => {
  it("starts with four collapsed toggles and no inputs", () => {
    renderWithI18n(<Harness />, "en");
    for (const p of ["facebook", "instagram", "tiktok", "website"] as const) {
      expect(toggle(L.platform[p])).toHaveAttribute("aria-expanded", "false");
    }
    expect(inputs()).toHaveLength(0);
    expect(screen.getByText(L.counterNone)).toBeInTheDocument();
  });

  it("pressing Instagram reveals one focused ltr input tied to the toggle", () => {
    renderWithI18n(<Harness />, "en");
    const btn = toggle(L.platform.instagram);
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    const fields = inputs();
    expect(fields).toHaveLength(1);
    const input = fields[0]!;
    expect(input).toHaveAttribute("dir", "ltr");
    expect(input).toHaveAttribute("maxlength", "300");
    expect(input).toHaveFocus();
    const panel = document.getElementById(btn.getAttribute("aria-controls")!);
    expect(panel).not.toBeNull();
    expect(panel!.contains(input)).toBe(true);
  });

  it("typing @shop shows the preview, a check on the button and the counter", () => {
    renderWithI18n(<Harness />, "en");
    fireEvent.click(toggle(L.platform.instagram));
    fireEvent.change(inputs()[0]!, { target: { value: "@shop" } });
    expect(screen.getByText("instagram.com/shop")).toBeInTheDocument();
    expect(screen.getByText(L.preview, { exact: false })).toBeInTheDocument();
    expect(within(toggle(L.platform.instagram)).getByText(L.saved)).toBeInTheDocument();
    expect(toggle(L.platform.instagram).querySelector("svg")).not.toBeNull();
    expect(screen.getByText(L.counterSome.replace("{count}", "1"))).toBeInTheDocument();
  });

  it("pressing again hides the input but keeps the value and the check", () => {
    renderWithI18n(<Harness />, "en");
    fireEvent.click(toggle(L.platform.instagram));
    fireEvent.change(inputs()[0]!, { target: { value: "@shop" } });
    fireEvent.click(toggle(L.platform.instagram));
    expect(toggle(L.platform.instagram)).toHaveAttribute("aria-expanded", "false");
    expect(inputs()).toHaveLength(0);
    expect(within(toggle(L.platform.instagram)).getByText(L.saved)).toBeInTheDocument();
    expect(screen.getByText(L.counterSome.replace("{count}", "1"))).toBeInTheDocument();
    fireEvent.click(toggle(L.platform.instagram));
    expect(inputs()[0]).toHaveValue("@shop");
  });

  it("an invalid non-empty value cannot be collapsed and its alert stays visible", () => {
    renderWithI18n(<Harness />, "en");
    fireEvent.click(toggle(L.platform.instagram));
    fireEvent.change(inputs()[0]!, { target: { value: "https://evil.example/shop" } });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(L.error.wrongHost);
    fireEvent.click(toggle(L.platform.instagram));
    expect(toggle(L.platform.instagram)).toHaveAttribute("aria-expanded", "true");
    expect(inputs()).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(L.error.wrongHost);
    expect(inputs()[0]).toHaveAttribute("aria-invalid", "true");
    expect(within(toggle(L.platform.instagram)).queryByText(L.saved)).toBeNull();
    expect(screen.getByText(L.counterNone)).toBeInTheDocument();
  });

  it("showErrors with every link blank shows the required message and opens Instagram", () => {
    renderWithI18n(<Harness showErrors />, "en");
    expect(screen.getByRole("alert")).toHaveTextContent(en.onboarding.error.linksRequired);
    expect(toggle(L.platform.instagram)).toHaveAttribute("aria-expanded", "true");
    expect(inputs()).toHaveLength(1);
  });

  it("a filled-but-invalid link shows its own reason, not the required message", () => {
    renderWithI18n(<Harness showErrors initial={{ ...blank, website: "javascript:alert(1)" }} />, "en");
    const alerts = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(alerts).toEqual([L.error.unsafeScheme]);
    expect(toggle(L.platform.website)).toHaveAttribute("aria-expanded", "true");
  });

  it("focusPlatform opens and focuses that input", () => {
    renderWithI18n(<Harness focusPlatform="tiktok" />, "en");
    expect(toggle(L.platform.tiktok)).toHaveAttribute("aria-expanded", "true");
    expect(inputs()[0]).toHaveFocus();
  });

  it("toggles are native buttons reachable and operable from the keyboard", () => {
    renderWithI18n(<Harness />, "en");
    const btn = toggle(L.platform.website);
    expect(btn.tagName).toBe("BUTTON");
    expect(btn).toHaveAttribute("type", "button");
    expect(btn).not.toHaveAttribute("tabindex", "-1");
    btn.focus();
    expect(btn).toHaveFocus();
    // A native button turns Enter / Space into a click; the click is what toggles.
    fireEvent.keyDown(btn, { key: "Enter" });
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    btn.focus();
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("opens a resumed draft's saved links with their values", () => {
    renderWithI18n(<Harness initial={{ ...blank, instagram: "https://www.instagram.com/shop" }} />, "en");
    expect(toggle(L.platform.instagram)).toHaveAttribute("aria-expanded", "true");
    expect(inputs()[0]).toHaveValue("https://www.instagram.com/shop");
    expect(screen.getByText("instagram.com/shop")).toBeInTheDocument();
  });

  it("renders in Arabic with the inputs still left-to-right", () => {
    renderWithI18n(<Harness />, "ar");
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${ar.onboarding.business.links.platform.tiktok}`) }));
    expect(inputs()[0]).toHaveAttribute("dir", "ltr");
    expect(screen.getByText(ar.onboarding.business.links.title)).toBeInTheDocument();
  });

  it("uses only semantic token classes (no hex, arbitrary or default-palette colours)", () => {
    renderWithI18n(<Harness showErrors initial={{ ...blank, instagram: "@shop", website: "javascript:x" }} />, "en");
    fireEvent.click(toggle(L.platform.facebook));
    const classes = [...document.body.querySelectorAll("[class]")].map((el) => el.getAttribute("class") ?? "");
    expect(classes.length).toBeGreaterThan(0);
    for (const c of classes) {
      for (const re of [HEX, ARBITRARY_COLOR, TAILWIND_PALETTE, UNKNOWN_SEMANTIC_UTILITY]) {
        expect(c).not.toMatch(new RegExp(re));
      }
    }
  });
});
