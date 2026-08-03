import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { CustomersTable } from "./customers-table";
import { ar } from "@/lib/i18n/messages/ar";
import type { CustomerRow } from "@/server/queries/sales";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function customer(over: Partial<CustomerRow>): CustomerRow {
  return {
    id: "d1",
    organization_id: "org",
    branch_id: "c1",
    display_name: "شركة النيل",
    customer_type: "company",
    primary_phone: "01000000001",
    primary_phone_e164: "+201000000001",
    email: null,
    email_normalized: null,
    preferred_language: "ar",
    location_summary: null,
    locality_id: null,
    source: "referral",
    assigned_membership_id: "mem1",
    status: "active",
    created_by: "u1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    archived_at: null,
    ...over,
  } as CustomerRow;
}

describe("CustomersTable", () => {
  it("renders a semantic table with translated headers and rows", () => {
    renderWithI18n(
      <CustomersTable
        customers={[
          customer({}),
          customer({ id: "d2", display_name: "أحمد", status: "archived", branch_id: null, assigned_membership_id: null }),
        ]}
        branchNames={{ c1: "فرع القاهرة" }}
        memberNames={{ mem1: "كريم" }}
      />,
    );
    const table = screen.getByRole("table");
    // Column headers exist (accessibility: semantic table).
    within(table).getByText(ar.customers.name);
    within(table).getByText(ar.customers.phone);
    // Rows render the customer names.
    expect(within(table).getAllByText("شركة النيل").length).toBeGreaterThan(0);
    // Branch + assignee resolve from the provided maps.
    within(table).getByText("فرع القاهرة");
    within(table).getByText("كريم");
    // Status badge translated (active -> نشط, archived -> مؤرشف).
    within(table).getByText(ar.customers.statusActive);
    within(table).getByText(ar.customers.statusArchived);
  });
});
