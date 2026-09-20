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
