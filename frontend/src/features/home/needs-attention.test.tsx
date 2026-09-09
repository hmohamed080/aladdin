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

  describe("bidi-safe user-generated titles", () => {
    // Regression for the mobile-Arabic defect: an English title rendered
    // inside the ambient RTL page, with no direction of its own, had its
    // OWN beginning clipped by single-line `truncate` — "…ha back with the
    // tile options" — because the bidi algorithm resolved the undirected
    // Latin run against the surrounding RTL flow. `dir="auto"` lets each
    // title's own script pick its own direction; `line-clamp-2` (never
    // `truncate`) means nothing needs an ellipsis until a title is
    // genuinely long in either language.

    it("gives every user-generated title (follow-up, quotation, name) its own dir=auto", () => {
      render(
        <NeedsAttentionSection
          overdueFollowUps={[followUp({ title: "Long English follow-up title" })]}
          quotationsAwaitingDecision={[quotation({ rfq_title: "Aluminium profiles - shopfront" })]}
          pendingJoinRequests={[joinRequest({ displayName: "Youssef Amin" })]}
          locale="ar"
          m={en}
        />,
      );
      expect(screen.getByText("Long English follow-up title")).toHaveAttribute("dir", "auto");
      expect(screen.getByText("Aluminium profiles - shopfront")).toHaveAttribute("dir", "auto");
      expect(screen.getByText("Youssef Amin")).toHaveAttribute("dir", "auto");
    });

    it("clamps to two lines instead of clipping to one — no truncate class left on any title", () => {
      render(
        <NeedsAttentionSection
          overdueFollowUps={[followUp({ title: "A very long follow-up title that would have to wrap" })]}
          quotationsAwaitingDecision={[]}
          pendingJoinRequests={[]}
          locale="en"
          m={en}
        />,
      );
      const title = screen.getByText("A very long follow-up title that would have to wrap");
      expect(title.className).toContain("line-clamp-2");
      expect(title.className).not.toContain("truncate");
    });

    it("renders a long Arabic title, a long English title, and a mixed-script title without losing any of their text", () => {
      const arabicTitle = "متابعة طويلة جدًا بخصوص طلب توريد بلاط السيراميك للفرع الجديد في مدينة نصر";
      const englishTitle = "Send the complete phase-one quantities and pricing to Nile View Interiors";
      const mixedTitle = "طلب Nile View لل-Aluminium profiles";
      render(
        <NeedsAttentionSection
          overdueFollowUps={[
            followUp({ id: "ar", title: arabicTitle }),
            followUp({ id: "en", title: englishTitle }),
            followUp({ id: "mixed", title: mixedTitle }),
          ]}
          quotationsAwaitingDecision={[]}
          pendingJoinRequests={[]}
          locale="ar"
          m={en}
        />,
      );
      // `.toHaveTextContent` normalizes whitespace but never drops characters —
      // exactly the property `truncate` broke and `line-clamp-2` restores.
      expect(screen.getByText(arabicTitle)).toHaveTextContent(arabicTitle);
      expect(screen.getByText(englishTitle)).toHaveTextContent(englishTitle);
      expect(screen.getByText(mixedTitle)).toHaveTextContent(mixedTitle);
    });
  });
});
