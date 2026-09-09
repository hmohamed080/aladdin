import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NeedsAttentionSection } from "./needs-attention";
import { en } from "@/lib/i18n/messages/en";
import type { FollowUpRow } from "@/server/queries/sales";
import type { QuotationListRow } from "@/server/queries/commerce";
import type { JoinRequestRow } from "@/server/queries/affiliation";

function followUp(overrides: Partial<FollowUpRow> = {}): FollowUpRow {
  return {
    id: "f1",
    organization_id: "org-a",
    branch_id: null,
    assigned_membership_id: "m1",
    customer_id: null,
    lead_id: null,
    title: "Call Amina about the tile order",
    description: null,
    due_at: "2026-09-10T10:00:00Z",
    status: "open",
    priority: "normal",
    created_by: "m1",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    version: 1,
    ...overrides,
  } as FollowUpRow;
}

function quotation(overrides: Partial<QuotationListRow> = {}): QuotationListRow {
  return {
    id: "q1",
    rfq_id: "rfq1",
    rfq_title: "Porcelain flooring — reception",
    requester_org_id: "org-a",
    supplier_org_id: "org-b",
    supplier_name: "Egypt Marble Manufacturing",
    requester_name: "Cairo Ceramics Showroom",
    status: "submitted",
    total: 54000,
    subtotal: 54000,
    item_count: 3,
    version: 1,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    submitted_at: "2026-09-01T00:00:00Z",
    decided_at: null,
    validity_date: null,
    ...overrides,
  } as QuotationListRow;
}

function joinRequest(overrides: Partial<JoinRequestRow> = {}): JoinRequestRow {
  return {
    requestId: "jr1",
    userId: "u1",
    displayName: "Karim Adel",
    emailMasked: "k***@example.test",
    persona: "sales",
    note: null,
    branchId: null,
    branchName: null,
    status: "pending",
    reason: null,
    createdAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

describe("NeedsAttentionSection", () => {
  it("shows the caught-up empty state when all three lists are empty", () => {
    render(
      <NeedsAttentionSection
        overdueFollowUps={[]}
        quotationsAwaitingDecision={[]}
        pendingJoinRequests={[]}
        locale="en"
        m={en}
      />,
    );
    expect(screen.getByText(en.home.needsAttention.emptyTitle)).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("deep-links each item type to its own record's page", () => {
    render(
      <NeedsAttentionSection
        overdueFollowUps={[followUp({ id: "f-42" })]}
        quotationsAwaitingDecision={[quotation({ id: "q-42" })]}
        pendingJoinRequests={[joinRequest({ requestId: "jr-42" })]}
        locale="en"
        m={en}
      />,
    );
    expect(screen.getByRole("link", { name: /Call Amina about the tile order/ })).toHaveAttribute(
      "href",
      "/b2b/follow-ups/f-42/edit",
    );
    expect(screen.getByRole("link", { name: /Porcelain flooring/ })).toHaveAttribute("href", "/b2b/quotations/q-42");
    expect(screen.getByRole("link", { name: /Karim Adel/ })).toHaveAttribute("href", "/b2b/organization");
  });

  it("renders only the records it was given — never data it wasn't handed", () => {
    // The component itself fetches nothing; this is the presentational-layer
    // proof that pairs with the query layer's own organization_id scoping
    // (recentQuotations/listJoinRequests/overdueFollowUps) — data from a
    // different org can only ever appear here if it was passed in, and nothing
    // this component does can substitute or merge in a second source.
    render(
      <NeedsAttentionSection
        overdueFollowUps={[followUp({ id: "org-a-followup", title: "Org A's own follow-up" })]}
        quotationsAwaitingDecision={[]}
        pendingJoinRequests={[]}
        locale="en"
        m={en}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Org A's own follow-up")).toBeInTheDocument();
  });

  it("never renders a mutation control — every item is a plain deep-link, not a form", () => {
    render(
      <NeedsAttentionSection
        overdueFollowUps={[followUp()]}
        quotationsAwaitingDecision={[quotation()]}
        pendingJoinRequests={[joinRequest()]}
        locale="en"
        m={en}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(document.querySelector("form")).toBeNull();
  });
});
