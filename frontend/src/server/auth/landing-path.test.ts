import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
const needs = vi.fn();
vi.mock("@/server/queries/landing", () => ({ resolveActiveLanding: vi.fn(async () => "/home") }));
vi.mock("@/server/queries/account-basics", async (orig) => ({
  ...(await orig<typeof import("@/server/queries/account-basics")>()),
  needsAccountBasics: () => needs(),
}));

import { entryLandingPath } from "./landing-path";

const client = (state: string) => ({ rpc: vi.fn(async () => ({ data: state, error: null })) }) as unknown as Parameters<typeof entryLandingPath>[0];

beforeEach(() => needs.mockReset());

describe("entryLandingPath and the account-basics screen", () => {
  it("sends an account that still owes basics to the screen, keeping the deep link", async () => {
    needs.mockResolvedValue(true);
    expect(await entryLandingPath(client("access_ready"), "/home/jobs")).toBe("/onboarding/basics?next=%2Fhome%2Fjobs");
  });

  it("lets a complete account straight through", async () => {
    needs.mockResolvedValue(false);
    expect(await entryLandingPath(client("access_ready"), "/home/jobs")).toBe("/home/jobs");
  });

  it("never asks before registration is finished", async () => {
    needs.mockResolvedValue(true);
    expect(await entryLandingPath(client("needs_account_type"), "/home")).toBe("/onboarding");
    expect(needs).not.toHaveBeenCalled();
  });
});
