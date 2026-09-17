import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/server/queries/page-context", () => ({ getPageContext: vi.fn() }));
vi.mock("@/server/queries/activity", () => ({ organizationActivity: vi.fn() }));

import ActivityPage from "./page";
import { organizationActivity } from "@/server/queries/activity";
import { getPageContext } from "@/server/queries/page-context";

const getPageContextMock = vi.mocked(getPageContext);
const organizationActivityMock = vi.mocked(organizationActivity);

function pageContext(capabilities: string[]) {
  return {
    locale: "en" as const,
    supabase: {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    } as never,
    org: {
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      organizationName: "Activity Test Org",
      orgType: "showroom",
      membershipId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      capabilities,
      canManageSales: false,
      branches: [],
      activeBranchId: null,
    },
  };
}

describe("ActivityPage authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    organizationActivityMock.mockResolvedValue({ events: [], nextBefore: null });
  });

  it.each([
    { label: "no relevant capability", capabilities: [] },
    { label: "org.manage alone", capabilities: ["org.manage"] },
  ])("renders an honest denial with $label", async ({ capabilities }) => {
    getPageContextMock.mockResolvedValue(pageContext(capabilities));

    render(await ActivityPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("You cannot view this activity log")).toBeInTheDocument();
    expect(organizationActivityMock).not.toHaveBeenCalled();
  });
});
