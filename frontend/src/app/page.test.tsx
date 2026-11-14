import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RootPage from "./page";

const state = vi.hoisted(() => ({ locale: "ar" as "ar" | "en", users: 1200 as number | null }));
vi.mock("next/font/local", () => ({ default: () => ({ variable: "font-var", className: "font-cls" }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: state.locale }) }) }));
vi.mock("@/features/landing-brand/landing-brand-stats.server", () => ({
  readLandingStats: async () => ({ users: state.users, organizations: null, products: 0 }),
}));

describe("homepage: one canonical Landing", () => {
  it("renders the brand Landing sections in Arabic", async () => {
    state.locale = "ar";
    const { container } = render(await RootPage());
    for (const id of ["top", "roles", "services", "market", "how", "why", "experience", "faq", "footer"]) {
      expect(container.querySelector(`#${id}`), id).not.toBeNull();
    }
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("علاء الدين");
  });

  it("renders English with an LTR-appropriate heading", async () => {
    state.locale = "en";
    render(await RootPage());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Aladdin");
  });

  it("shows only stats that are real: a null or zero count renders no pill", async () => {
    state.locale = "en";
    state.users = 1200;
    const { container } = render(await RootPage());
    const pills = container.querySelectorAll("ul li strong");
    expect(Array.from(pills).map((n) => n.textContent)).toContain("+1K");
    expect(container.textContent).not.toContain("250");
    expect(container.textContent).not.toContain("4,800");
  });

  it("hides the whole stat row when no count is available", async () => {
    state.locale = "en";
    state.users = null;
    const { container } = render(await RootPage());
    expect(container.textContent).not.toMatch(/users$/);
    expect(container.querySelector("section")?.querySelectorAll("li").length).toBe(0);
  });
});
