import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { ar } from "@/lib/i18n/messages/ar";

/**
 * F3/regression-review — the assignment dropdown this form renders is exactly
 * what the capability-regression review flagged: with an empty `members` list
 * (the F3-fix-introduced bug, now closed by `sales_assignable_members`), the
 * assignee `<select>` had only "Unassigned" as an option, and a caller who
 * never touched the field risked silently clearing a real assignment because
 * no `<option>` existed for `currentAssigneeId`. These pin the corrected,
 * expected shape: when the resolved member list includes the current
 * assignee (the normal case for any caller who legitimately reaches this
 * form via canAssign()), their real name renders as the pre-selected option
 * — never a raw membership id, and never silently defaulted to "Unassigned".
 *
 * Round 2 (branch-scoping correction) — `members` became `membersByBranch`
 * (keyed by branch id, `""` = org-wide): these tests exercise the branch the
 * form starts on (`currentBranchId`), plus the branch-switch behavior that
 * must never silently drop or submit a now-incompatible assignee.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/server/actions/sales-forms", () => ({ setCustomerOwnershipAction: vi.fn() }));

import { CustomerOwnershipForm } from "./customer-ownership-form";

const YOUSSEF = "50000002-0000-4000-8000-000000000002";
const HANA = "50000001-0000-4000-8000-000000000001";
const CAIRO = "c1111111-cccc-4ccc-8ccc-cccccccccccc";
const ZAYED = "c2222222-cccc-4ccc-8ccc-cccccccccccc";

beforeEach(() => vi.clearAllMocks());

function openDialog() {
  fireEvent.click(screen.getByText(ar.customers.ownershipTitle));
}

describe("CustomerOwnershipForm — assignee dropdown reflects resolved teammate names", () => {
  it("pre-selects the current assignee by their real name, not left on Unassigned", async () => {
    renderWithI18n(
      <CustomerOwnershipForm
        customerId="d0000001-0000-4000-8000-000000000001"
        expectedUpdatedAt="2026-08-05T10:00:00.123456+00:00"
        currentBranchId={CAIRO}
        currentAssigneeId={YOUSSEF}
        branches={[{ id: CAIRO, name: "Cairo Branch" }]}
        membersByBranch={{
          [CAIRO]: [
            { membershipId: HANA, displayName: "Hana Mansour" },
            { membershipId: YOUSSEF, displayName: "Youssef Amin" },
          ],
        }}
        canOrgWide={false}
      />,
    );
    openDialog();
    const select = (await screen.findByLabelText(ar.customers.assignee)) as HTMLSelectElement;
    // The regression this guards: the select's ACTUAL value is the current
    // assignee's id, because a real <option> exists for it — not the first
    // option ("Unassigned") a browser falls back to when no option matches.
    expect(select.value).toBe(YOUSSEF);
    expect(within(select).getByRole("option", { name: "Youssef Amin" })).toBeInTheDocument();
  });

  it("lists every resolved teammate as a real name — never a raw membership id", async () => {
    renderWithI18n(
      <CustomerOwnershipForm
        customerId="d0000001-0000-4000-8000-000000000001"
        expectedUpdatedAt="2026-08-05T10:00:00.123456+00:00"
        currentBranchId={CAIRO}
        currentAssigneeId={null}
        branches={[{ id: CAIRO, name: "Cairo Branch" }]}
        membersByBranch={{
          [CAIRO]: [
            { membershipId: HANA, displayName: "Hana Mansour" },
            { membershipId: YOUSSEF, displayName: "Youssef Amin" },
          ],
        }}
        canOrgWide={false}
      />,
    );
    openDialog();
    const select = (await screen.findByLabelText(ar.customers.assignee)) as HTMLSelectElement;
    const optionTexts = within(select)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(optionTexts).toEqual(expect.arrayContaining(["Hana Mansour", "Youssef Amin"]));
    for (const text of optionTexts) {
      expect(text).not.toMatch(/^[0-9a-f]{8}-/i);
      expect(text).not.toBe(HANA);
      expect(text).not.toBe(YOUSSEF);
    }
  });

  it("with no other assignable teammate, offers only Unassigned — a genuinely empty org, not a silent failure", async () => {
    renderWithI18n(
      <CustomerOwnershipForm
        customerId="d0000001-0000-4000-8000-000000000001"
        expectedUpdatedAt="2026-08-05T10:00:00.123456+00:00"
        currentBranchId={CAIRO}
        currentAssigneeId={null}
        branches={[{ id: CAIRO, name: "Cairo Branch" }]}
        membersByBranch={{ [CAIRO]: [] }}
        canOrgWide={false}
      />,
    );
    openDialog();
    const select = (await screen.findByLabelText(ar.customers.assignee)) as HTMLSelectElement;
    expect(within(select).getAllByRole("option")).toHaveLength(1);
    expect(select.value).toBe("");
  });
});

describe("CustomerOwnershipForm — branch-reactive candidates never strand or silently drop an assignee", () => {
  it("re-filters the assignee list when the branch changes", async () => {
    renderWithI18n(
      <CustomerOwnershipForm
        customerId="d0000001-0000-4000-8000-000000000001"
        expectedUpdatedAt="2026-08-05T10:00:00.123456+00:00"
        currentBranchId={CAIRO}
        currentAssigneeId={null}
        branches={[
          { id: CAIRO, name: "Cairo Branch" },
          { id: ZAYED, name: "Sheikh Zayed Branch" },
        ]}
        membersByBranch={{
          [CAIRO]: [{ membershipId: YOUSSEF, displayName: "Youssef Amin" }],
          [ZAYED]: [{ membershipId: HANA, displayName: "Hana Mansour" }],
        }}
        canOrgWide={false}
      />,
    );
    openDialog();
    const branchSelect = (await screen.findByLabelText(ar.customers.branch)) as HTMLSelectElement;
    const assigneeSelect = screen.getByLabelText(ar.customers.assignee) as HTMLSelectElement;
    expect(within(assigneeSelect).queryByRole("option", { name: "Hana Mansour" })).not.toBeInTheDocument();

    fireEvent.change(branchSelect, { target: { value: ZAYED } });

    expect(within(assigneeSelect).getByRole("option", { name: "Hana Mansour" })).toBeInTheDocument();
    expect(within(assigneeSelect).queryByRole("option", { name: "Youssef Amin" })).not.toBeInTheDocument();
  });

  it("moving to a branch that strands the current assignee keeps them selected (flagged), never silently clears or drops them", async () => {
    renderWithI18n(
      <CustomerOwnershipForm
        customerId="d0000001-0000-4000-8000-000000000001"
        expectedUpdatedAt="2026-08-05T10:00:00.123456+00:00"
        currentBranchId={CAIRO}
        currentAssigneeId={YOUSSEF}
        branches={[
          { id: CAIRO, name: "Cairo Branch" },
          { id: ZAYED, name: "Sheikh Zayed Branch" },
        ]}
        membersByBranch={{
          [CAIRO]: [{ membershipId: YOUSSEF, displayName: "Youssef Amin" }],
          [ZAYED]: [{ membershipId: HANA, displayName: "Hana Mansour" }],
        }}
        canOrgWide={false}
      />,
    );
    openDialog();
    const branchSelect = (await screen.findByLabelText(ar.customers.branch)) as HTMLSelectElement;
    const assigneeSelect = screen.getByLabelText(ar.customers.assignee) as HTMLSelectElement;

    fireEvent.change(branchSelect, { target: { value: ZAYED } });

    // Never silently falls back to the first option ("Unassigned") or to
    // Sheikh Zayed's real candidate (Hana) — Youssef stays the actual value.
    expect(assigneeSelect.value).toBe(YOUSSEF);
    expect(screen.getByText(ar.states.assigneeBranch)).toBeInTheDocument();
    // And the confirm button is blocked while the stale selection stands.
    expect(screen.getByRole("button", { name: ar.common.saveChanges })).toBeDisabled();
  });
});
