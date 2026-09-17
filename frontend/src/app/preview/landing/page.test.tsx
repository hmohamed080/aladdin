import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LandingPreviewPage, { metadata } from "./page";

const cookieState = vi.hoisted(() => ({ locale: "ar" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: cookieState.locale }) }),
}));

describe("landing preview", () => {
  it("is excluded from search indexing", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it.each([
    ["ar", /علاء الدين.*يربط كل أطراف التشطيبات/, "ابدأ الآن"],
    ["en", /Aladdin.*Connects every side of finishing/, "Start now"],
  ] as const)("renders the complete %s preview with local anchors and artwork", async (locale, heading, start) => {
    cookieState.locale = locale;
    const { container } = render(await LandingPreviewPage());

    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: start })).toHaveAttribute("href", "/auth/sign-up");
    const anchors = container.querySelectorAll<HTMLAnchorElement>('a[href^="#"]');
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) {
      expect(container.querySelector(anchor.hash)).toBeInTheDocument();
    }
    const images = [...container.querySelectorAll("img")];
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(decodeURIComponent(image.getAttribute("src") ?? "")).toContain("/preview/landing/");
    }
    expect(container.querySelector("footer")).toBeInTheDocument();
  });
});
