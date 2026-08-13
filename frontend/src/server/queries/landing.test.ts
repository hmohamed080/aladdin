import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database.types";

vi.mock("server-only", () => ({}));

const { loadPlatformRole } = vi.hoisted(() => ({ loadPlatformRole: vi.fn() }));
vi.mock("@/server/queries/platform", () => ({ loadPlatformRole }));

const { cookieValue } = vi.hoisted(() => ({ cookieValue: { current: undefined as string | undefined } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));

import { resolveActiveLanding } from "./landing";

// The my_workspaces() row shape: a Personal row carries a `persona` and a Business
// row an `org_type`, in separate columns of separate types (Sprint 13).
type Row = {
  kind: string;
  organization_id: string | null;
  name: string;
  persona: string | null;
  org_type: string | null;
  relationship: string | null;
};

const personal: Row = {
  kind: "personal",
  organization_id: null,
  name: "Ahmed Hassan",
  persona: "engineer",
  org_type: null,
  relationship: null,
};
const business = (id: string, name: string): Row => ({
  kind: "business",
  organization_id: id,
  name,
  persona: null,
  org_type: "showroom_dealer",
  relationship: "owner",
});

function clientWithWorkspaces(rows: Row[]) {
  const rpc = vi.fn(async () => ({ data: rows, error: null }));
  return {
    client: { rpc } as unknown as SupabaseClient<Database>,
    rpc,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadPlatformRole.mockResolvedValue(null);
  cookieValue.current = undefined;
});

describe("resolveActiveLanding", () => {
  it("routes platform staff to /admin without consulting workspaces", async () => {
    const { client, rpc } = clientWithWorkspaces([business("org-1", "Cairo Ceramics")]);
    loadPlatformRole.mockResolvedValueOnce("administrator");

    await expect(resolveActiveLanding(client)).resolves.toBe("/admin");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("routes a BUSINESS-ONLY identity to /b2b — never a fake personal home", async () => {
    // No personal entry at all: the person has no personal persona.
    const { client } = clientWithWorkspaces([business("org-1", "Cairo Ceramics")]);

    await expect(resolveActiveLanding(client)).resolves.toBe("/b2b");
  });

  it("routes a personal-only identity to /home", async () => {
    const { client } = clientWithWorkspaces([personal]);

    await expect(resolveActiveLanding(client)).resolves.toBe("/home");
  });

  it("prefers Personal for a mixed identity with no valid selection", async () => {
    // Owning a business no longer evicts a person from their personal home.
    const { client } = clientWithWorkspaces([personal, business("org-1", "AH Design Studio")]);

    await expect(resolveActiveLanding(client)).resolves.toBe("/home");
  });

  it("honors an explicit business selection for a mixed identity", async () => {
    cookieValue.current = "org-1";
    const { client } = clientWithWorkspaces([personal, business("org-1", "AH Design Studio")]);

    await expect(resolveActiveLanding(client)).resolves.toBe("/b2b");
  });

  it("falls back safely when the selected workspace is no longer available", async () => {
    // The cookie names an org whose membership was revoked: it is simply not in
    // the caller's entries any more, so landing resolves to what they do have.
    cookieValue.current = "org-revoked";
    const { client } = clientWithWorkspaces([business("org-2", "Delta Wholesale")]);

    await expect(resolveActiveLanding(client)).resolves.toBe("/b2b");
  });

  it("sends a caller with no usable workspace to the account-safe /home", async () => {
    const { client } = clientWithWorkspaces([]);

    await expect(resolveActiveLanding(client)).resolves.toBe("/home");
  });
});
