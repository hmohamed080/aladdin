import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RootPage from "./page";

const state = vi.hoisted(() => ({ environment: "staging" as string | undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "ar" }) }) }));
// If the page ever reads the public env again, this mock hands it the value under
// test — which is exactly what these tests prove it no longer cares about.
vi.mock("@/lib/env", () => ({ readPublicEnv: () => ({ NEXT_PUBLIC_APP_ENV: state.environment }) }));

const ENVIRONMENTS = ["staging", "production", "local", "preview", undefined] as const;

describe("homepage: one canonical Landing, whatever the environment", () => {
  it.each(ENVIRONMENTS)("renders the approved Landing (LandingMotion > Hero + Ecosystem) for NEXT_PUBLIC_APP_ENV=%s", async (environment) => {
    state.environment = environment;
    const { container } = render(await RootPage());
    const parts = Array.from(container.querySelectorAll("[data-landing-preview-part]")).map((n) =>
      n.getAttribute("data-landing-preview-part"),
    );
    expect(parts).toEqual(expect.arrayContaining(["Header", "Hero", "Ecosystem", "FinalCta", "Footer"]));
    expect(container.querySelectorAll('[data-content-slot="video"]').length).toBe(5);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it.each(ENVIRONMENTS)("never falls back to the old landing-v2 stack for NEXT_PUBLIC_APP_ENV=%s", async (environment) => {
    state.environment = environment;
    const { container } = render(await RootPage());
    expect(container.querySelector("[data-landing-v2-part]")).toBeNull();
  });

  it("renders identical markup in every environment", async () => {
    const html: string[] = [];
    for (const environment of ENVIRONMENTS) {
      state.environment = environment;
      const { container, unmount } = render(await RootPage());
      html.push(container.innerHTML);
      unmount();
    }
    expect(new Set(html).size).toBe(1);
  });

  it("the page source neither reads the environment nor imports the old landing-v2 stack", () => {
    // Comments may explain the history; only executable code is checked.
    const source = readFileSync(join(__dirname, "page.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(source).not.toMatch(/NEXT_PUBLIC_APP_ENV|readPublicEnv|process\.env|VERCEL_ENV/);
    expect(source).not.toMatch(/from\s+["'][^"']*landing-v2/);
  });
});
