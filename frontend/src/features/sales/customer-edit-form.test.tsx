import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { ar } from "@/lib/i18n/messages/ar";
import type { CustomerRow } from "@/server/queries/sales";

/**
 * Sprint 6.2 — deterministic UI proof that the customer edit form renders the
 * localized STALE-CONFLICT state (and refreshes) when the trusted action reports
 * `states.staleConflict`. The RPC 40001 is proven by pgTAP 19 + the two-session
 * race script; the 40001→conflict mapping by the sales-forms unit tests; this
 * pins the last link — the form actually shows the localized message.
 */
const refresh = vi.fn();
const updateCustomerAction = vi.fn(async () => ({ ok: false, code: "states.staleConflict" as const }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/server/actions/sales-forms", () => ({ updateCustomerAction: (...a: unknown[]) => updateCustomerAction(...(a as [])) }));

import { CustomerEditForm } from "./customer-edit-form";

const customer = {
  id: "d0000001-0000-4000-8000-000000000001",
  display_name: "Nile",
  customer_type: "company",
  primary_phone: "01000000001",
  email: "nile@example.test",
  preferred_language: "ar",
  location_summary: "Nasr City",
  source: "referral",
  branch_id: "c1111111-cccc-4ccc-8ccc-cccccccccccc",
  assigned_membership_id: "e2222222-eeee-4eee-8eee-eeeeeeeeeee2",
  updated_at: "2026-08-05T10:00:00.123456+00:00",
} as unknown as CustomerRow;

beforeEach(() => vi.clearAllMocks());

describe("CustomerEditForm — stale conflict", () => {
  it("renders the localized stale-conflict alert and refreshes on a stale submit", async () => {
    renderWithI18n(<CustomerEditForm customer={customer} branchName="Cairo Branch" assigneeName="Rep" />);
    const form = screen.getByLabelText(ar.customers.name).closest("form")!;
    await act(async () => {
      fireEvent.submit(form);
    });
    // The action was called and its stale-conflict outcome is shown to the user…
    expect(updateCustomerAction).toHaveBeenCalledTimes(1);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(ar.states.staleConflict);
    // …and the form re-fetched the current server state.
    expect(refresh).toHaveBeenCalled();
  });
});
