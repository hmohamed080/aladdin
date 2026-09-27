import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RootPage from "./page";

const state = vi.hoisted(() => ({ environment: "staging" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "ar" }) }) }));
vi.mock("@/lib/env", () => ({ readPublicEnv: () => ({ NEXT_PUBLIC_APP_ENV: state.environment }) }));

describe("homepage promotion boundary", () => {
  it.each(["staging", "production", "local"])("selects the approved homepage for %s", async (environment) => {
    state.environment = environment;
    const { container } = render(await RootPage());
    expect(container.querySelector('[data-landing-preview-part="Header"]') !== null).toBe(environment === "staging");
    expect(container.querySelectorAll('[data-content-slot="video"]').length).toBe(environment === "staging" ? 5 : 0);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});

describe("installer entry point on the homepage", () => {
  // Production/local homepage (landing-v2). The staging homepage's installer
  // entry is its role dialog — covered in landing-preview/landing-details.test.tsx.
  it.each(["production", "local"])("the installer tile (and only it) links to /installer/sign-up on %s", async (environment) => {
    state.environment = environment;
    const { container } = render(await RootPage());
    const strip = container.querySelector('[data-landing-v2-part="AudienceStrip"]');
    expect(strip).not.toBeNull();
    const links = Array.from(strip!.querySelectorAll("a"));
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/installer/sign-up");
    expect(links[0]).toHaveTextContent("الصنايعية والفنيون");
  });

  it("no other homepage registration link is redirected to the installer flow", async () => {
    state.environment = "production";
    const { container } = render(await RootPage());
    const installerLinks = Array.from(container.querySelectorAll('a[href^="/installer/"]'));
    expect(installerLinks.map((a) => a.textContent?.trim())).toEqual(["الصنايعية والفنيون"]);
    expect(container.querySelectorAll('a[href="/auth/sign-up"]').length).toBeGreaterThan(0);
  });
});
