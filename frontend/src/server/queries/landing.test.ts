import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database.types";

vi.mock("server-only", () => ({}));

const { loadPlatformRole } = vi.hoisted(() => ({ loadPlatformRole: vi.fn() }));
vi.mock("@/server/queries/platform", () => ({ loadPlatformRole }));

import { resolveActiveLanding } from "./landing";

function clientWithMembership(membership: { id: string } | null) {
  const maybeSingle = vi.fn(async () => ({ data: membership, error: null }));
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    limit: vi.fn(),
    maybeSingle,
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);

  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })) },
    from: vi.fn(() => chain),
  } as unknown as SupabaseClient<Database>;

  return { client, chain };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadPlatformRole.mockResolvedValue(null);
});

describe("resolveActiveLanding", () => {
  it("routes platform staff to /admin without inferring authority from membership", async () => {
    const { client } = clientWithMembership({ id: "membership-1" });
    loadPlatformRole.mockResolvedValueOnce("administrator");

    await expect(resolveActiveLanding(client)).resolves.toBe("/admin");
    expect(client.from).not.toHaveBeenCalled();
  });

  it("routes an active organization member to /b2b", async () => {
    const { client, chain } = clientWithMembership({ id: "membership-1" });

    await expect(resolveActiveLanding(client)).resolves.toBe("/b2b");
    expect(client.from).toHaveBeenCalledWith("memberships");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(chain.eq).toHaveBeenCalledWith("status", "active");
  });

  it("routes an active organization-less account to /home", async () => {
    const { client } = clientWithMembership(null);

    await expect(resolveActiveLanding(client)).resolves.toBe("/home");
  });
});
