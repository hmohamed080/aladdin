import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RootPage from "./page";

const state = vi.hoisted(() => ({ users: 1200 as number | null }));
vi.mock("next/font/local", () => ({ default: () => ({ variable: "font-var", className: "font-cls" }) }));
vi.mock("@/features/landing-brand/landing-brand-stats.server", () => ({
  readLandingStats: async () => ({ users: state.users, organizations: null, products: 0 }),
}));

describe("homepage: one canonical Landing", () => {
  it("renders the brand Landing sections in Arabic, with no language switch", async () => {
    const { container } = render(await RootPage());
    for (const id of ["top", "roles", "services", "market", "how", "why", "experience", "faq", "footer"]) {
      expect(container.querySelector(`#${id}`), id).not.toBeNull();
    }
    expect(screen.getAllByRole("heading", { level: 1 })[0]).toHaveTextContent("علاء الدين");
    expect(container.textContent).not.toMatch(/English|\bEN\b/);
  });

  it("shows only stats that are real: a null or zero count renders no pill", async () => {
    state.users = 1200;
    const { container } = render(await RootPage());
    const pills = container.querySelectorAll("ul li strong");
    expect(Array.from(pills).map((n) => n.textContent)).toContain("+1,200");
    expect(container.textContent).not.toContain("250");
  });

  it("hides the whole stat row when no count is available", async () => {
    state.users = null;
    const { container } = render(await RootPage());
    expect(container.querySelector("section")?.querySelectorAll("li").length).toBe(0);
  });
});
