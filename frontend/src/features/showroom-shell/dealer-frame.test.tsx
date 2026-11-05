import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  workspace: { active: null } as { active: { orgType: string | null; organizationId?: string } | null },
  loads: 0,
}));

vi.mock("@/server/queries/request-workspace", () => ({
  loadRequestWorkspaceContext: async () => {
    state.loads += 1;
    return state.workspace;
  },
}));
vi.mock("./frame", () => ({
  ShowroomFrame: ({ children }: { children: ReactNode }) => <div data-testid="showroom-frame">{children}</div>,
}));
const guard = vi.hoisted(() => ({ org: { orgType: "showroom_dealer" as string | null } }));
vi.mock("@/features/showroom-shell/context", () => ({
  requireShowroomContext: async () => ({ org: guard.org }),
}));

import { ShowroomDealerFrame } from "./dealer-frame";
import ShowroomLayout from "@/app/(workspace)/showroom/layout";

beforeEach(() => {
  state.workspace = { active: null };
  state.loads = 0;
  guard.org = { orgType: "showroom_dealer" };
});

describe("ShowroomDealerFrame (the (workspace) group layout)", () => {
  it("frames a showroom dealer once, above both /showroom and /b2b", async () => {
    state.workspace = { active: { orgType: "showroom_dealer" } };
    render(await ShowroomDealerFrame({ children: <p>page</p> }));
    expect(screen.getAllByTestId("showroom-frame")).toHaveLength(1);
    expect(screen.getByText("page")).toBeInTheDocument();
  });

  it.each(["supplier", "manufacturer", "importer", "design_office", "contractor_company", null])(
    "does not frame %s - that type keeps the shell its own tree already draws",
    async (orgType) => {
      state.workspace = { active: { orgType } };
      render(await ShowroomDealerFrame({ children: <p>page</p> }));
      expect(screen.queryByTestId("showroom-frame")).not.toBeInTheDocument();
      expect(screen.getByText("page")).toBeInTheDocument();
    },
  );

  it("passes a caller with no active organization through, for the tree's own layout to redirect or explain", async () => {
    state.workspace = { active: null };
    render(await ShowroomDealerFrame({ children: <p>page</p> }));
    expect(screen.queryByTestId("showroom-frame")).not.toBeInTheDocument();
    expect(screen.getByText("page")).toBeInTheDocument();
  });

  it("reads the work context exactly once", async () => {
    state.workspace = { active: { orgType: "showroom_dealer" } };
    await ShowroomDealerFrame({ children: null });
    expect(state.loads).toBe(1);
  });
});

describe("/showroom layout (guard + shell for the non-dealer types)", () => {
  it("never nests a second shell for a dealer: the group layout already drew it", async () => {
    render(await ShowroomLayout({ children: <p>page</p> }));
    expect(screen.queryByTestId("showroom-frame")).not.toBeInTheDocument();
    expect(screen.getByText("page")).toBeInTheDocument();
  });

  it.each(["supplier", "manufacturer", "importer", "design_office"])(
    "still frames %s on /showroom, exactly as before",
    async (orgType) => {
      guard.org = { orgType };
      render(await ShowroomLayout({ children: <p>page</p> }));
      expect(screen.getAllByTestId("showroom-frame")).toHaveLength(1);
    },
  );
});
