import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithI18n } from "@/test/render";
import { LandingV2Hero } from "./landing-v2-hero";

describe("LandingV2Hero", () => {
  it("renders the approved Arabic-first copy and real account destinations", () => {
    const { container } = renderWithI18n(<LandingV2Hero />);

    expect(screen.getByRole("heading", { name: /علاء الدين.*يربط كل أطراف التشطيبات/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ابدأ الآن" })).toHaveAttribute("href", "/auth/sign-up");
    expect(screen.getByRole("link", { name: "تسجيل الدخول" })).toHaveAttribute("href", "/auth/sign-in");
    expect(container.querySelector('[data-landing-v2-part="ShowroomVisual"]')).toBeInTheDocument();
    expect(container.querySelector('[data-landing-v2-part="ProductMockup"]')).not.toBeInTheDocument();
    const imageSources = [...container.querySelectorAll("img")].map((image) =>
      decodeURIComponent(image.getAttribute("src") ?? ""),
    );
    expect(imageSources).toHaveLength(2);
    expect(imageSources).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/landing-v2/hero/background-2-new-trimmed.png"),
        expect.stringContaining("/brand/aladdin-logo.png"),
      ]),
    );
  });

  it("renders equivalent English content without changing the fixed cap composition", () => {
    const { container } = renderWithI18n(<LandingV2Hero />, "en");

    expect(screen.getByRole("heading", { name: /Aladdin.*Connects every side of finishing/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start now" })).toHaveAttribute("href", "/auth/sign-up");
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeInTheDocument();
    expect(container.querySelector("section > div")).toHaveAttribute("dir", "ltr");
    expect(container.querySelector('[data-landing-v2-part="ProductMockup"]')).not.toBeInTheDocument();
  });
});
