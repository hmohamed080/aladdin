import {describe, expect, it, vi} from "vitest";
vi.mock("server-only", () => ({}));
const env = vi.hoisted(() => ({NEXT_PUBLIC_APP_ENV:"local", NEXT_PUBLIC_SUPABASE_URL:"http://127.0.0.1:64321"}));
vi.mock("@/lib/env", () => ({readPublicEnv: () => env}));
import {publicPortfolioSamplesEnabled} from "./public-portfolio-samples";
describe("local illustrative portfolio gate", () => {
  it("requires all four local-only conditions", () => {
    const id = "63fdd659-36a2-473f-9db2-4d163a2373a5";
    expect(publicPortfolioSamplesEnabled(id,"localhost:3350")).toBe(true);
    expect(publicPortfolioSamplesEnabled("another-id","localhost:3350")).toBe(false);
    expect(publicPortfolioSamplesEnabled(id,"public.example.com")).toBe(false);
    env.NEXT_PUBLIC_APP_ENV="production";
    expect(publicPortfolioSamplesEnabled(id,"localhost:3350")).toBe(false);
    env.NEXT_PUBLIC_APP_ENV="local"; env.NEXT_PUBLIC_SUPABASE_URL="https://hosted.supabase.co";
    expect(publicPortfolioSamplesEnabled(id,"localhost:3350")).toBe(false);
  });
});
