import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MarketplacePage from "./page";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "ar" }) }) }));

describe("/marketplace: coming soon until the Marketplace ships", () => {
  it("shows the coming-soon message with the landing header and a way back home", async () => {
    const { container } = render(await MarketplacePage());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("السوق قريبًا");
    expect(container.querySelector('[data-landing-preview-part="Header"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: "السوق" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "العودة للرئيسية" })).toHaveAttribute("href", "/");
  });
});
